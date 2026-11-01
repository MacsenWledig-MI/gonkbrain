/* The Floor: household ledger
   Pure arithmetic, no DOM. Every constant is a sourced 2025 figure or a design
   choice from "The Floor: Economic Package" (November 2026). Edit the constants
   and the page recomputes; the page shows them all.
   CC0: do what you like with it. */
(function (root) {
  'use strict';

  const CONST = {
    // Design choices (the package, "Paying for it")
    contributionRate: 0.05,            // household health contribution on income above the threshold
    thresholdSingle: 20000,
    thresholdJoint: 40000,
    employerRate: 0.075,               // employer (and self-employment) health contribution on payroll; first $2M of an employer's payroll exempt
    vatRate: 0.05,                     // value-added tax, broad base (the package's closing measure)
    vatBaseShare: 0.60,                // share of consumption the broad base covers (CBO's broad base is about 60% of consumption)
    surtaxRate: 0.02,                  // 2-point surtax on income above $100k single / $200k joint
    surtaxStartSingle: 100000,
    surtaxStartJoint: 200000,
    bracketBump: 0.02,                 // top four federal brackets up 2 points (CBO option)
    bracketStartSingle: 103350,        // 2025 taxable income where the 24% bracket begins
    bracketStartJoint: 206700,
    standardDeductionSingle: 15750,    // 2025, after P.L. 119-21
    standardDeductionJoint: 31500,
    rentShare: 0.30,                   // rent guarantee: nobody pays more than 30% of income for a modest home
    modestRentSingle: 1465,            // HUD 2025 fair market rent, one bedroom, national (NLIHC Out of Reach 2025)
    modestRentFamily: 1749,            // two bedrooms
    rentFullSingle: 44000,             // full guarantee to about 60% of area median income (one person; HUD FY2025 national median family income $104,200)
    rentZeroSingle: 58000,             // tapering to zero at about 80%
    rentFullFamily: 62000,
    rentZeroFamily: 83000,
    foodPerPersonMonth: 256,           // USDA Thrifty Food Plan, Sept 2026: $1,024 a month for a family of four
    foodTaperEnd: 2.5,                 // credit is full at the poverty line and reaches zero at 250% of it
    povertyBase: 15650,                // 2025 HHS poverty guideline, one person
    povertyPerExtra: 5500,             // each additional person
    singleTaperRate: 0.25,             // the Floor's combined withdrawal of food and rent is capped at 25 cents per dollar above the poverty line
    // What people pay now (KFF 2025 Employer Health Benefits Survey; CMS NHE 2024)
    workerPremiumSingle: 1440,
    workerPremiumFamily: 6850,
    employerPremiumSingle: 7885,       // $9,325 total less the worker share
    employerPremiumFamily: 20143,      // $26,993 total less the worker share
    oopPerPerson: 900,                 // out-of-pocket spending per resident on care the Floor covers. Total OOP was $1,630 a person in 2024 ($556.6B / 341.8M);
                                       // CBO's Option 3 ends about 42% of it (the rest is over-the-counter items, nursing-home private pay until 2032, and other
                                       // non-covered care), and the Floor's zero drug cost sharing adds a little: about $300B of the $557B, roughly $900 a person
    oopPerPersonMedicaid: 300,         // Medicaid cost sharing is nominal; assumption
    medicarePartB: 2220,               // 2025 Part B premium, $185 a month
    stateTaxRate: 0.04,                // generic state income tax for the pass-through calculation; Michigan is 4.25%
    ficaEmployee: 0.0765,
    ssWageBase: 176100                 // 2025 Social Security wage base
  };

  // 2025 federal brackets (taxable income), single and joint
  const BRACKETS = {
    single: [[11925, 0.10], [48475, 0.12], [103350, 0.22], [197300, 0.24], [250525, 0.32], [626350, 0.35], [Infinity, 0.37]],
    joint: [[23850, 0.10], [96950, 0.12], [206700, 0.22], [394600, 0.24], [501050, 0.32], [751600, 0.35], [Infinity, 0.37]]
  };

  function marginalFederal(taxable, filing) {
    const b = BRACKETS[filing];
    for (let i = 0; i < b.length; i++) if (taxable < b[i][0]) return b[i][1];
    return 0.37;
  }

  // Consumption as a share of income, for the VAT line (declines with income; approximate)
  function consumptionShare(income) {
    if (income < 50000) return 0.95;
    if (income < 150000) return 0.80;
    if (income < 400000) return 0.65;
    return 0.50;
  }

  function num(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Math.max(0, Number(v)); }

  /* input = {
       income: number (household, annual, before tax),
       filing: 'single' | 'joint',
       people: integer >= 1,
       coverage: 'employer-single' | 'employer-family' | 'own' | 'medicare' | 'medicaid' | 'none',
       wageEarner: boolean (someone in the household works for wages; the 7.5% employer contribution then applies),
       smallEmployer: boolean (the employer's payroll is under $2 million; exempt from the 7.5%),
       premiumNow: number | null (annual premiums the household itself pays; overrides the average),
       oopNow: number | null (annual out-of-pocket medical bills; overrides the average),
       rent: number | null (monthly),
       tuition: number | null (annual public tuition and fees the household pays now)
     } */
  function ledger(input) {
    const C = CONST;
    const income = Math.max(0, Number(input.income) || 0);
    const filing = input.filing === 'joint' ? 'joint' : 'single';
    const people = Math.max(1, Math.round(Number(input.people) || 1));
    const family = people > 1;
    const wageEarner = input.wageEarner !== false && income > 0;
    const smallEmployer = !!input.smallEmployer;

    // 1. Floor contribution
    const threshold = filing === 'joint' ? C.thresholdJoint : C.thresholdSingle;
    const contribution = C.contributionRate * Math.max(0, income - threshold);

    // 2. Surtax above $100k/$200k, and the bracket bump
    const surtaxStart = filing === 'joint' ? C.surtaxStartJoint : C.surtaxStartSingle;
    const surtax = C.surtaxRate * Math.max(0, income - surtaxStart);
    const stdDed = filing === 'joint' ? C.standardDeductionJoint : C.standardDeductionSingle;
    const taxable = Math.max(0, income - stdDed);
    const bracketStart = filing === 'joint' ? C.bracketStartJoint : C.bracketStartSingle;
    const bracketExtra = C.bracketBump * Math.max(0, taxable - bracketStart);

    // 3. VAT on the broad base of consumption
    const consumption = income * consumptionShare(income);
    const vat = C.vatRate * C.vatBaseShare * consumption;

    // 4. Premiums that end
    let premiumNow = 0, employerPremium = 0, premiumLabel = '';
    switch (input.coverage) {
      case 'employer-single':
        premiumNow = C.workerPremiumSingle; employerPremium = C.employerPremiumSingle;
        premiumLabel = 'average worker share of a single employer plan (KFF 2025)'; break;
      case 'employer-family':
        premiumNow = C.workerPremiumFamily; employerPremium = C.employerPremiumFamily;
        premiumLabel = 'average worker share of a family employer plan (KFF 2025)'; break;
      case 'own':
        premiumNow = 0; premiumLabel = 'your own premium (enter it)'; break;
      case 'medicare':
        premiumNow = C.medicarePartB * Math.min(people, 2);
        premiumLabel = (people > 1 ? 'two ' : '') + 'Medicare Part B premium' + (people > 1 ? 's' : '') + ', 2025 ($185 a month each; add Medigap or Part D if you pay them)'; break;
      default:
        premiumNow = 0; premiumLabel = 'no premium today'; break;
    }
    const premiumOverride = num(input.premiumNow);
    if (premiumOverride !== null) { premiumNow = premiumOverride; premiumLabel = 'the premium you entered'; }

    // 5. Out-of-pocket bills that end
    let oop = (input.coverage === 'medicaid' ? C.oopPerPersonMedicaid : C.oopPerPerson) * people;
    let oopLabel = input.coverage === 'medicaid'
      ? 'Medicaid cost sharing is nominal; about $300 a person assumed'
      : 'the part of average out-of-pocket spending that is for care the Floor covers, about $900 of $1,630 a person (CMS 2024, CBO); over-the-counter items and nursing-home care continue; higher for older people and the uninsured, lower for healthy insured families';
    const oopOverride = num(input.oopNow);
    if (oopOverride !== null) { oop = oopOverride; oopLabel = 'the out-of-pocket figure you entered'; }

    // 6. The employer side. The 7.5% applies to all payroll above an employer's first $2 million, whether or
    //    not the employer offers coverage. CBO (2022) models employer health costs as passing to workers as
    //    taxable wages over time; by the same logic a new levy comes out of wages. The range below runs from
    //    none of the net change reaching your paycheck to all of it.
    const employerContribution = (wageEarner && !smallEmployer) ? C.employerRate * income : 0;
    const netEmployerChange = employerPremium - employerContribution;   // positive: the employer saves; negative: it pays more
    const fica = income < C.ssWageBase ? C.ficaEmployee : 0.0145;
    const marginal = Math.min(0.6, marginalFederal(taxable, filing) + fica + C.stateTaxRate);
    const passThroughAfterTax = netEmployerChange * (1 - marginal);

    // 7. Rent guarantee: full to 60% of area median, tapering to zero at 80%
    let rentSubsidy = 0, rentShareOfFull = 0, rentCapped = 0;
    const rent = num(input.rent);
    if (rent !== null && rent > 0) {
      const cap = family ? C.modestRentFamily : C.modestRentSingle;
      const full = family ? C.rentFullFamily : C.rentFullSingle;
      const zero = family ? C.rentZeroFamily : C.rentZeroSingle;
      rentCapped = Math.min(rent, cap);
      rentShareOfFull = income <= full ? 1 : income >= zero ? 0 : (zero - income) / (zero - full);
      rentSubsidy = Math.max(0, rentCapped * 12 - C.rentShare * income) * rentShareOfFull;
    }

    // 8. Food credit: full at the poverty line, tapering to zero at 250% of it
    const poverty = C.povertyBase + C.povertyPerExtra * (people - 1);
    const ratio = income / poverty;
    const taper = Math.max(0, Math.min(1, (C.foodTaperEnd - ratio) / (C.foodTaperEnd - 1)));
    const foodFull = C.foodPerPersonMonth * 12 * people;
    let foodCredit = foodFull * taper;

    // 9. The single taper: the two tapered guarantees together may not fall faster than 25 cents per dollar
    //    of income above the poverty line. Compute the pair at the poverty line and apply the cap.
    const rentAtPoverty = (rent !== null && rent > 0) ? Math.max(0, rentCapped * 12 - C.rentShare * poverty) : 0;
    const bundleAtPoverty = foodFull + rentAtPoverty;
    const bundleUncapped = foodCredit + rentSubsidy;
    const bundleFloor = Math.max(0, bundleAtPoverty - C.singleTaperRate * Math.max(0, income - poverty));
    let singleTaperAdd = 0;
    if (income > poverty && bundleFloor > bundleUncapped) {
      singleTaperAdd = bundleFloor - bundleUncapped;
    }

    // 10. Tuition
    const tuition = num(input.tuition) || 0;

    const stopsPaying = premiumNow + oop + rentSubsidy + foodCredit + singleTaperAdd + tuition;
    const newCosts = contribution + surtax + bracketExtra + vat;
    const noIncidence = stopsPaying - newCosts;             // none of the employer's change reaches your paycheck
    const fullIncidence = noIncidence + passThroughAfterTax; // all of it does, after tax (lower if the employer pays more)
    const low = Math.min(noIncidence, fullIncidence);
    const high = Math.max(noIncidence, fullIncidence);

    return {
      input: { income, filing, people, coverage: input.coverage, wageEarner, smallEmployer, rent, tuition },
      contribution, threshold, surtax, surtaxStart, bracketExtra, taxable, bracketStart, vat, consumption,
      premiumNow, premiumLabel, employerPremium, employerContribution, netEmployerChange, marginal, passThroughAfterTax,
      oop, oopLabel, rentSubsidy, rentShareOfFull, rentCapped,
      poverty, ratio, taper, foodCredit, singleTaperAdd, bundleAtPoverty,
      tuition, stopsPaying, newCosts, noIncidence, fullIncidence, low, high
    };
  }

  root.FloorLedger = { ledger, CONST, BRACKETS };
})(typeof window !== 'undefined' ? window : globalThis);
