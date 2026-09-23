import { SetMetadata } from "@nestjs/common";
export const ALLOW_UNVERIFIED_MFA_KEY = "allowUnverifiedMfa";
export const AllowUnverifiedMfa = () => SetMetadata(ALLOW_UNVERIFIED_MFA_KEY, true);
