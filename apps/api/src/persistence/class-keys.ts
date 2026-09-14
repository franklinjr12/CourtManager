export const classCatalogKey = (org: string, classId = '') => ({
  PK: `ORG#${org}#CLASSES`,
  SK: `CLASS#${classId}`,
});
export const classEnrollmentKey = (
  org: string,
  classId: string,
  customerId: string,
) => ({ PK: `ORG#${org}#CLASS#${classId}`, SK: `CUSTOMER#${customerId}` });
