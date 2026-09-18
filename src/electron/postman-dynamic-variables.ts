import { faker } from '@faker-js/faker'

type DynamicVariableFactory = () => string | number | boolean

function digits(count: number) {
  return faker.string.numeric(count)
}

export function createPostmanDynamicVariableGlobals(): Record<string, DynamicVariableFactory> {
  return {
    $guid: () => faker.string.uuid(),
    $randomUUID: () => faker.string.uuid(),
    $timestamp: () => Math.floor(Date.now() / 1000),
    $isoTimestamp: () => new Date().toISOString(),
    $randomInt: () => faker.number.int({ min: 0, max: 1000 }),
    $randomBoolean: () => faker.datatype.boolean(),
    $randomAlphaNumeric: () => faker.string.alphanumeric(1),
    $randomHexColor: () => faker.color.rgb(),
    $randomColor: () => faker.color.human(),
    $randomPhoneNumber: () => `${digits(3)}-${digits(3)}-${digits(4)}`,
    $randomPhoneNumberExt: () => `${digits(3)}-${digits(3)}-${digits(4)} x${digits(2)}`,
    $randomFirstName: () => faker.person.firstName(),
    $randomLastName: () => faker.person.lastName(),
    $randomFullName: () => faker.person.fullName(),
    $randomUserName: () => faker.internet.username(),
    $randomEmail: () => faker.internet.email(),
    $randomPassword: () => faker.internet.password(),
    $randomDomainName: () => faker.internet.domainName(),
    $randomDomainWord: () => faker.internet.domainWord(),
    $randomUrl: () => faker.internet.url(),
    $randomIP: () => faker.internet.ipv4(),
    $randomIPV6: () => faker.internet.ipv6(),
    $randomMACAddress: () => faker.internet.mac(),
    $randomCity: () => faker.location.city(),
    $randomStreetName: () => faker.location.street(),
    $randomStreetAddress: () => faker.location.streetAddress(),
    $randomCountry: () => faker.location.country(),
    $randomCountryCode: () => faker.location.countryCode(),
    $randomLatitude: () => faker.location.latitude(),
    $randomLongitude: () => faker.location.longitude(),
    $randomZipCode: () => faker.location.zipCode(),
    $randomCompanyName: () => faker.company.name(),
    $randomJobTitle: () => faker.person.jobTitle(),
    $randomLoremWord: () => faker.lorem.word(),
    $randomLoremWords: () => faker.lorem.words(),
    $randomLoremSentence: () => faker.lorem.sentence(),
    $randomLoremParagraph: () => faker.lorem.paragraph(),
  }
}

export { faker }
