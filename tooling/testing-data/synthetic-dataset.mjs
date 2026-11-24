/**
 * The synthetic Testing dataset (MW-004), as plain data. Deterministic: the same inputs always give
 * the same codes, names and amounts, which is what makes the loader idempotent. No real personal
 * data: given names are the NATO spelling alphabet, family names say "Synthetic", every e-mail is at
 * example.test (RFC 2606, never deliverable), and no national identifier is generated at all.
 */

export const MINIMUM_EMPLOYEES = 20;
export const MAXIMUM_EMPLOYEES = 50;
export const DEFAULT_EMPLOYEES = 30;

/** Everything the loader creates starts with this, so a tester can tell synthetic rows apart. */
export const PREFIX = 'syn';

export const GIVEN_NAMES = [
  ['Alfa', 'ألفا'],
  ['Bravo', 'برافو'],
  ['Charlie', 'تشارلي'],
  ['Delta', 'دلتا'],
  ['Echo', 'إيكو'],
  ['Foxtrot', 'فوكستروت'],
  ['Golf', 'غولف'],
  ['Hotel', 'هوتيل'],
  ['India', 'إنديا'],
  ['Juliett', 'جولييت'],
];
export const FAMILY_NAMES = [
  ['Synthetic', 'تجريبي'],
  ['Testdata', 'بيانات-اختبار'],
  ['Sample', 'عينة'],
  ['Placeholder', 'نائب'],
  ['Fixture', 'مثبت'],
];

export const CURRENCY = { code: 'JOD', exponent: 3 };
export const EFFECTIVE_FROM = '2026-01-01';

export const UNIT_TYPES = [
  {
    code: `${PREFIX}-company`,
    name: { en: 'Synthetic company', ar: 'شركة تجريبية' },
    ordinal: 1,
    allowedAtRoot: true,
    carriesLegalEntity: true,
  },
  {
    code: `${PREFIX}-department`,
    name: { en: 'Synthetic department', ar: 'قسم تجريبي' },
    ordinal: 2,
    allowedParentCodes: [`${PREFIX}-company`],
    allowedAtRoot: false,
    carriesLegalEntity: false,
  },
];

export const COMPANY = {
  code: `${PREFIX}-co`,
  typeCode: `${PREFIX}-company`,
  name: { en: 'Synthetic Testing Company', ar: 'شركة الاختبار التجريبية' },
};

export const DEPARTMENTS = [
  { code: `${PREFIX}-dept-hr`, name: { en: 'Synthetic HR', ar: 'الموارد البشرية التجريبية' } },
  { code: `${PREFIX}-dept-ops`, name: { en: 'Synthetic Operations', ar: 'العمليات التجريبية' } },
  { code: `${PREFIX}-dept-fin`, name: { en: 'Synthetic Finance', ar: 'المالية التجريبية' } },
].map((department) => ({ ...department, typeCode: `${PREFIX}-department` }));

export const LEGAL_ENTITY = {
  countryCode: 'JO',
  registeredName: { en: 'Synthetic Testing Company LLC', ar: 'شركة الاختبار التجريبية ذ.م.م' },
  registrationNumber: 'SYN-REG-0001',
  currencyCode: CURRENCY.code,
};

/** One position per department, budgeted there (the establishment), so each has a home. */
export const POSITIONS = [
  {
    code: `${PREFIX}-pos-hr-officer`,
    title: { en: 'HR officer', ar: 'موظف موارد بشرية' },
    departmentCode: `${PREFIX}-dept-hr`,
  },
  {
    code: `${PREFIX}-pos-operator`,
    title: { en: 'Operator', ar: 'مشغل' },
    departmentCode: `${PREFIX}-dept-ops`,
  },
  {
    code: `${PREFIX}-pos-accountant`,
    title: { en: 'Accountant', ar: 'محاسب' },
    departmentCode: `${PREFIX}-dept-fin`,
  },
];
export const BUDGETED_HEADCOUNT = 20;

export const LEAVE_TYPE = {
  code: `${PREFIX}-annual`,
  name: { en: 'Synthetic annual leave', ar: 'إجازة سنوية تجريبية' },
  unit: 'days',
  paidTreatmentCode: 'full-pay',
  accrues: false,
};
export const LEAVE_POLICY = {
  code: `${PREFIX}-annual-policy`,
  name: { en: 'Synthetic annual leave policy', ar: 'سياسة الإجازة السنوية التجريبية' },
  approvalsRequired: 1,
};
/** 14 working days of 8 hours, in the minutes the ledger keeps. */
export const ENTITLEMENT_MINUTES = 14 * 8 * 60;

export const ATTENDANCE_POLICY = {
  code: `${PREFIX}-attendance-policy`,
  name: { en: 'Synthetic attendance policy', ar: 'سياسة الحضور التجريبية' },
  lateToleranceMinutes: 10,
  earlyDepartureToleranceMinutes: 10,
};
export const SHIFT = {
  code: `${PREFIX}-day-shift`,
  name: { en: 'Synthetic day shift', ar: 'وردية نهارية تجريبية' },
  kind: 'fixed',
  startLocal: '08:00',
  endLocal: '16:00',
  graceInMinutes: 10,
  graceOutMinutes: 10,
};
export const SHIFT_SEGMENTS = [
  { sequence: 1, kind: 'work', startLocal: '08:00', endLocal: '12:00', paid: true },
  { sequence: 2, kind: 'break', startLocal: '12:00', endLocal: '12:30', paid: true },
  { sequence: 3, kind: 'work', startLocal: '12:30', endLocal: '16:00', paid: true },
];
/** A Sunday-to-Thursday week: cycle day 0 is the Sunday the anchor names. */
export const SCHEDULE = {
  code: `${PREFIX}-week`,
  name: { en: 'Synthetic working week', ar: 'أسبوع عمل تجريبي' },
  zone: 'Asia/Amman',
  cycleLengthDays: 7,
  cycleAnchorDate: '2026-01-04',
  workingPositions: [0, 1, 2, 3, 4],
};

export const COMPONENT = {
  code: `${PREFIX}-base-salary`,
  name: { en: 'Synthetic base salary', ar: 'راتب أساسي تجريبي' },
  kind: 'base',
  calculationBasis: 'fixed_amount',
  roundingMode: 'half-up',
  recurrence: 'recurring',
  payrollTreatmentCode: 'basic-salary',
  proratable: true,
};
export const PLAN = {
  code: `${PREFIX}-standard-plan`,
  name: { en: 'Synthetic standard plan', ar: 'خطة قياسية تجريبية' },
  defaultCurrencyCode: CURRENCY.code,
  defaultCurrencyExponent: CURRENCY.exponent,
};

export const PAYROLL_GROUP = {
  code: `${PREFIX}-monthly`,
  name: { en: 'Synthetic monthly payroll', ar: 'رواتب شهرية تجريبية' },
  payFrequency: 'monthly',
  permittedCurrencies: [{ code: CURRENCY.code, exponent: CURRENCY.exponent }],
  prorationBasis: 'calendar_days',
  roundingMode: 'half-up',
  paysSuspended: false,
  expenseAccount: 'syn-6100',
  deductionAccount: 'syn-2300',
  payableAccount: 'syn-2100',
  paymentMethodCode: 'bank-transfer',
};
export const DEDUCTION = {
  code: `${PREFIX}-voluntary-savings`,
  name: { en: 'Synthetic voluntary savings', ar: 'ادخار طوعي تجريبي' },
  deductionSource: 'voluntary',
  payrollTreatmentCode: 'voluntary-savings',
  basis: 'fixed_amount',
  fixedAmountMinor: '10000',
  roundingMode: 'half-up',
  priority: 100,
};

const pad = (value, width = 3) => String(value).padStart(width, '0');

const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** The payroll period for a `YYYY-MM` month: the whole month, paid on its 25th. */
export const payrollPeriod = (month) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError(`not a YYYY-MM month: ${month}`);
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    code: `${PREFIX}-${month}`,
    periodStart: `${month}-01`,
    periodEnd: `${month}-${pad(lastDay, 2)}`,
    paymentDate: `${month}-25`,
  };
};

/**
 * The employees, one per index. Every value derives from the index alone: rerunning with the same
 * count gives the same people, and a larger count only appends.
 */
export const employees = (count = DEFAULT_EMPLOYEES) => {
  if (!Number.isInteger(count) || count < MINIMUM_EMPLOYEES || count > MAXIMUM_EMPLOYEES) {
    throw new RangeError(
      `employee count must be an integer from ${MINIMUM_EMPLOYEES} to ${MAXIMUM_EMPLOYEES}`,
    );
  }
  return Array.from({ length: count }, (_, index) => {
    const number = pad(index + 1);
    // Ten given names by five family names: fifty distinct pairs, so no two synthetic people
    // share a name and People's duplicate check has nothing to match.
    const [givenEn, givenAr] = GIVEN_NAMES[index % GIVEN_NAMES.length];
    const [familyEn, familyAr] = FAMILY_NAMES[Math.floor(index / GIVEN_NAMES.length)];
    const position = POSITIONS[index % POSITIONS.length];
    return {
      index,
      personNumber: `${PREFIX}-p-${number}`,
      externalEmployeeNumber: `SYN-E-${number}`,
      legalName: { en: `${givenEn} ${familyEn}`, ar: `${givenAr} ${familyAr}` },
      // Spread over 1975-1999 so no two share a birth date either.
      dateOfBirth: addDays('1975-01-01', index * 181),
      email: `synthetic.employee.${number}@example.test`,
      employmentTypeCode: 'permanent',
      startDate: EFFECTIVE_FROM,
      departmentCode: position.departmentCode,
      positionCode: position.code,
      // 450.000 to 940.000 JOD a month, in minor units (fils).
      baseSalaryMinor: String((450 + index * 10) * 1000),
    };
  });
};
