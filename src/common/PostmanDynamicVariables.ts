export const POSTMAN_DYNAMIC_VARIABLES = [
  { name: '$guid', aliases: ['randomGuid'], description: 'Random UUID v4' },
  { name: '$randomUUID', aliases: [], description: 'Random UUID v4' },
  { name: '$timestamp', aliases: [], description: 'Current Unix timestamp in seconds' },
  { name: '$isoTimestamp', aliases: [], description: 'Current ISO timestamp' },
  { name: '$randomInt', aliases: [], description: 'Random integer from 0 to 1000' },
  { name: '$randomBoolean', aliases: [], description: 'Random true or false value' },
  { name: '$randomAlphaNumeric', aliases: [], description: 'Random alphanumeric character' },
  { name: '$randomHexColor', aliases: [], description: 'Random hexadecimal color' },
  { name: '$randomColor', aliases: [], description: 'Random color name' },
  { name: '$randomPhoneNumber', aliases: ['randomPhoneNumber'], description: 'Random ten-digit phone number' },
  { name: '$randomPhoneNumberExt', aliases: [], description: 'Random phone number with extension' },
  { name: '$randomFirstName', aliases: [], description: 'Random first name' },
  { name: '$randomLastName', aliases: [], description: 'Random last name' },
  { name: '$randomFullName', aliases: [], description: 'Random full name' },
  { name: '$randomUserName', aliases: [], description: 'Random username' },
  { name: '$randomEmail', aliases: [], description: 'Random email address' },
  { name: '$randomPassword', aliases: [], description: 'Random password' },
  { name: '$randomDomainName', aliases: [], description: 'Random domain name' },
  { name: '$randomDomainWord', aliases: [], description: 'Random domain word' },
  { name: '$randomUrl', aliases: [], description: 'Random URL' },
  { name: '$randomIP', aliases: [], description: 'Random IPv4 address' },
  { name: '$randomIPV6', aliases: [], description: 'Random IPv6 address' },
  { name: '$randomMACAddress', aliases: [], description: 'Random MAC address' },
  { name: '$randomCity', aliases: [], description: 'Random city' },
  { name: '$randomStreetName', aliases: [], description: 'Random street name' },
  { name: '$randomStreetAddress', aliases: [], description: 'Random street address' },
  { name: '$randomCountry', aliases: [], description: 'Random country' },
  { name: '$randomCountryCode', aliases: [], description: 'Random country code' },
  { name: '$randomLatitude', aliases: [], description: 'Random latitude' },
  { name: '$randomLongitude', aliases: [], description: 'Random longitude' },
  { name: '$randomZipCode', aliases: [], description: 'Random postal code' },
  { name: '$randomCompanyName', aliases: [], description: 'Random company name' },
  { name: '$randomJobTitle', aliases: [], description: 'Random job title' },
  { name: '$randomLoremWord', aliases: [], description: 'Random lorem word' },
  { name: '$randomLoremWords', aliases: [], description: 'Random lorem words' },
  { name: '$randomLoremSentence', aliases: [], description: 'Random lorem sentence' },
  { name: '$randomLoremParagraph', aliases: [], description: 'Random lorem paragraph' },
] as const

export const POSTMAN_DYNAMIC_VARIABLE_ALIASES: ReadonlyMap<string, string> = new Map(
  POSTMAN_DYNAMIC_VARIABLES.flatMap(variable => variable.aliases.map(alias => [alias, variable.name] as const))
)

export const POSTMAN_DYNAMIC_VARIABLE_NAMES: ReadonlySet<string> = new Set(
  POSTMAN_DYNAMIC_VARIABLES.map(variable => variable.name)
)
