/* The Floor: household ledger
   Pure arithmetic, no DOM. Every constant is a sourced 2025 figure or a design
   choice from "The Floor: Economic Package" (October 2026). Edit the constants
   and the page recomputes; the page shows them all.
   CC0: do what you like with it. */
(function (root) {
  'use strict';

  const CONST = {
    // Design choices (the package, "Paying for it")
    contributionRate: 0.04,            // household health contribution on income above the threshold
    employerRate: 0.075,               // employer health contribution on payroll (first $2M of an employer's payroll exempt; assumed to apply to yours)
    thresholdSingle: 20000,
    thresholdJoint: 40000,
    bracketBump: 0.02,                 // top four federal brackets up 2 points (CBO option)
    bracketStartSingle: 103350,        // 2025 taxable income where the 24% bracket begins
    bracketStartJoint: 206700,
    standardDeductionSingle: 15750,    // 2025, after P.L. 119-21
    standardDeductionJoint: 31500,
    rentShare: 0.30,                   // rent guarantee: nobody pays more than 30% of income for a modest home
    modestRentSingle: 1465,            // HUD 2025 fair market rent, one bedroom, national (NLIHC Out of Reach 2025)
    modestRentFamily: 1749,            // two bedrooms
    rentEligibleSingle: 58000,         // about 80% of area median income, one person (HUD FY2025 national median family income $104,200)
    rentEligibleFamily: 83000,         // about 80% of AMI, family of four
    foodPerPersonMonth: 256,           // USDA Thrifty Food Plan, Sept 2026: $1,024 a month for a family of four
    foodTaperEnd: 2.5,                 // credit is full at the poverty line and reaches zero at 250% of it
    povertyBase: 15650,                // 2025 HHS poverty guideline, one person
    povertyPerExtra: 5500,             // each additional person
    // What people pay now (KFF 2025 Employer Health Benefits Survey; CMS NHE 2024)
    workerPremiumSingle: 1440,
    workerPremiumFamily: 6850,
    employerPremiumSingle: 7885,       // $9,325 total less the worker share
    employerPremiumFamily: 20143,      // $26,993 total less the worker share
    oopPerPerson: 1630,                // out-of-pocket spending per resident, 2024 ($556.6B / 341.8M)
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

  /* input = {
       income: number (household, annual, before tax),
       filing: 'single' | 'joint',
       people: integer >= 1,
       coverage: 'employer-single' | 'employer-family' | 'own' | 'medicare' | 'medicaid-none',
       premiumNow: number | null (annual, what the household itself pays; overrides the average),
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

    // 1. Floor contribution
    const threshold = filing === 'joint' ? C.thresholdJoint : C.thresholdSingle;
    const contribution = C.contributionRate * Math.max(0, income - threshold);

    // 2. Bracket bump (top four brackets up two points)
    const stdDed = filing === 'joint' ? C.standardDeductionJoint : C.standardDeductionSingle;
    const taxable = Math.max(0, income - stdDed);
    const bracketStart = filing === 'joint' ? C.bracketStartJoint : C.bracketStartSingle;
    const bracketExtra = C.bracketBump * Math.max(0, taxable - bracketStart);

    // 3. Premiums that end
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
        premiumNow = C.medicarePartB; premiumLabel = 'Medicare Part B premium, 2025 ($185 a month; add Medigap or Part D if you pay them)'; break;
      default:
        premiumNow = 0; premiumLabel = 'no premium today'; break;
    }
    if (input.premiumNow !== null && input.premiumNow !== undefined && input.premiumNow !== '' && !isNaN(Number(input.premiumNow))) {
      premiumNow = Math.max(0, Number(input.premiumNow));
      premiumLabel = 'the premium you entered';
    }

    // 4. Out-of-pocket bills that end (national average per person unless you enter your own)
    let oop = C.oopPerPerson * people, oopLabel = 'national average out-of-pocket spending per person, 2024 (CMS)';
    if (input.oopNow !== null && input.oopNow !== undefined && input.oopNow !== '' && !isNaN(Number(input.oopNow))) {
      oop = Math.max(0, Number(input.oopNow));
      oopLabel = 'the out-of-pocket figure you entered';
    }

    // 5. The employer side: the premium it stops paying, less its 7.5% Floor contribution on your wages.
    //    CBO (2022) models employer health costs as passing to workers as taxable wages over time, so the
    //    net change can reach your paycheck; the range below runs from none of it to all of it.
    const employerContribution = employerPremium > 0 ? C.employerRate * income : 0;
    const netEmployerChange = employerPremium - employerContribution;   // positive: the employer saves; negative: it pays more
    const fica = income < C.ssWageBase ? C.ficaEmployee : 0.0145;
    const marginal = Math.min(0.6, marginalFederal(taxable, filing) + fica + C.stateTaxRate);
    const passThroughAfterTax = netEmployerChange * (1 - marginal);

    // 6. Rent guarantee
    let rentSubsidy = 0, rentEligible = false, rentCapped = 0;
    const rent = input.rent === null || input.rent === undefined || input.rent === '' ? null : Math.max(0, Number(input.rent));
    if (rent !== null && rent > 0) {
      const cap = family ? C.modestRentFamily : C.modestRentSingle;
      const limit = family ? C.rentEligibleFamily : C.rentEligibleSingle;
      rentEligible = income <= limit;
      rentCapped = Math.min(rent, cap);
      if (rentEligible) rentSubsidy = Math.max(0, rentCapped * 12 - C.rentShare * income);
    }

    // 7. Food credit
    const poverty = C.povertyBase + C.povertyPerExtra * (people - 1);
    const ratio = income / poverty;
    const taper = Math.max(0, Math.min(1, (C.foodTaperEnd - ratio) / (C.foodTaperEnd - 1)));
    const foodFull = C.foodPerPersonMonth * 12 * people;
    const foodCredit = foodFull * taper;

    // 8. Tuition
    const tuition = input.tuition === null || input.tuition === undefined || input.tuition === '' ? 0 : Math.max(0, Number(input.tuition));

    const stopsPaying = premiumNow + oop + rentSubsidy + foodCredit + tuition;
    const newCosts = contribution + bracketExtra;
    const noIncidence = stopsPaying - newCosts;             // none of the employer's change reaches your paycheck
    const fullIncidence = noIncidence + passThroughAfterTax; // all of it does, after tax (can be lower if the employer pays more)
    const low = Math.min(noIncidence, fullIncidence);
    const high = Math.max(noIncidence, fullIncidence);

    return {
      input: { income, filing, people, coverage: input.coverage, rent, tuition },
      contribution, threshold, bracketExtra, taxable, bracketStart,
      premiumNow, premiumLabel, employerPremium, employerContribution, netEmployerChange, marginal, passThroughAfterTax,
      oop, oopLabel, rentSubsidy, rentEligible, rentCapped,
      poverty, ratio, taper, foodCredit,
      tuition, stopsPaying, newCosts, noIncidence, fullIncidence, low, high
    };
  }

  root.FloorLedger = { ledger, CONST, BRACKETS };
})(typeof window !== 'undefined' ? window : globalThis);
