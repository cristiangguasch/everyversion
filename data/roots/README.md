# Extra trusted roots for Windows code-signature checks

`scripts/verify.mjs` validates Windows signatures against the macOS system roots plus the certificates in this folder.
Each was downloaded from Microsoft and its SHA-1 fingerprint matched the value Microsoft publishes at
https://www.microsoft.com/pkiops/docs/repository.htm (retrieved 2026-11-04).

| File | Source | SHA-1 fingerprint |
|---|---|---|
| microsoft-identity-verification-root-ca-2020.crt | https://www.microsoft.com/pkiops/certs/microsoft%20identity%20verification%20root%20certificate%20authority%202020.crt | F40042E2E5F7E8EF8189FED15519AECE42C3BFA2 |
| microsoft-root-ca-2010.crt | https://www.microsoft.com/pki/certs/MicRooCerAut_2010-06-23.crt | 3B1EFD3A66EA28B16697394703A72CA340A05BD5 |
| microsoft-root-ca-2011.crt | https://www.microsoft.com/pki/certs/MicRooCerAut2011_2011_03_22.crt | 8F43288AD272F3103B6FB1428485EA3014C0BCFE |
