/**
 * "Verified merchant": an admin's mark that MyPlug checked a store's registration, premises and
 * contacts. The checklist guides the admin; only a verified primary document is required.
 */
export type VerificationInput = {
  isTradesperson: boolean;
  registrationNumber: string | null;
  physicalAddress: string | null;
  serviceArea: string | null;
  phone: string | null;
  primaryDocumentCurrent: boolean; // registration certificate (handymen: national ID), verified and in date
};

export function verificationChecklist(s: VerificationInput) {
  return [
    {
      key: "document",
      label: s.isTradesperson ? "National ID verified" : "Registration certificate or licence verified and in date",
      done: s.primaryDocumentCurrent,
      required: true,
    },
    { key: "registration", label: "Business registration number given", done: !!s.registrationNumber, required: false },
    {
      key: "address",
      label: s.isTradesperson ? "Service area given" : "Physical address (shop, office or warehouse) given",
      done: !!(s.isTradesperson ? s.serviceArea || s.physicalAddress : s.physicalAddress),
      required: false,
    },
    { key: "phone", label: "Phone number on the account", done: !!s.phone, required: false },
  ];
}
