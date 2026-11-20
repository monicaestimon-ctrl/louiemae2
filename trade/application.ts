export const BUSINESS_TYPES = {
  hosp: {
    l: 'Restaurant, café or bar',
    s: 'Buying for your own space',
    cred: 'Food service permit, health permit or liquor license number',
    how: 'Checked against state or city license lookup. Liquor licenses are public record.',
  },
  design: {
    l: 'Interior designer',
    s: 'Buying for clients',
    cred: 'Resale certificate, ASID or IIDA member number, or portfolio link',
    how: 'Checked against the sales tax permit lookup or member directory.',
  },
  re: {
    l: 'Real estate or stager',
    s: 'Staging and model homes',
    cred: 'Real estate license number',
    how: 'Checked against your state real estate commission search.',
  },
  build: {
    l: 'Home builder or contractor',
    s: 'Builds and developments',
    cred: 'Contractor or builder license number',
    how: 'Checked against state or city contractor license lookup.',
  },
  pm: {
    l: 'Project manager',
    s: 'Buying on behalf of a company',
    cred: 'Company work email, or a letter of authorization from the owner',
    how: 'We verify the company itself. Orders ship and bill to that business.',
  },
  retail: {
    l: 'Retailer',
    s: 'Reselling in your shop',
    cred: 'Resale certificate',
    how: 'Checked against the state sales tax permit lookup.',
  },
};
export const REGISTRATION_STATES = [
  'Alabama',
  'Arizona',
  'California',
  'Colorado',
  'Connecticut',
  'Florida',
  'Georgia',
  'Illinois',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'New Jersey',
  'New York',
  'North Carolina',
  'Ohio',
  'Oregon',
  'Pennsylvania',
  'Tennessee',
  'Texas',
  'Virginia',
  'Washington',
  'Other',
];

export type BusinessType = keyof typeof BUSINESS_TYPES;
export type ApplicationValues = {
  type: BusinessType | '';
  name: string;
  state: string;
  ein: string;
  web: string;
  cred: string;
  company: string;
  email: string;
  tax: boolean;
  cert: File | null;
};
export type ApplicationField = keyof ApplicationValues | '_form';
/** Mirror the existing application input requirements before changing steps or uploading files. */
export function applicationErrors(
  values: ApplicationValues,
  step?: number
): Partial<Record<ApplicationField, string>> {
  const errors: Partial<Record<ApplicationField, string>> = {};
  if (step === undefined || step === 0) {
    if (!values.type || !Object.hasOwn(BUSINESS_TYPES, values.type))
      errors.type = 'Choose your business type.';
  }
  if (step === undefined || step === 1) {
    if (!values.name.trim() || values.name.length > 200)
      errors.name = 'Enter your legal business name (up to 200 characters).';
    if (!/^\d{2}-\d{7}$/.test(values.ein))
      errors.ein = 'Enter the 9-digit EIN, written 12-3456789.';
    if (!values.web.trim() || values.web.length > 300)
      errors.web = 'Add a website or business Instagram (up to 300 characters).';
  }
  if (step === undefined || step === 2) {
    if (values.type === 'pm') {
      if (!values.company.trim()) errors.company = 'Enter the company you are buying for.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
        errors.email = 'Enter your work email at that company.';
    } else if (!values.cred.trim() || values.cred.length > 500)
      errors.cred = 'Add your industry credential (up to 500 characters).';
  }
  if (
    (step === undefined || step === 3) &&
    values.tax &&
    values.cert &&
    values.cert.size > 10 * 1024 * 1024
  )
    errors.cert = 'Use a certificate file no larger than 10 MB.';
  return errors;
}
