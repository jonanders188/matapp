// Compatibility alias. The canonical implementation lives at
// app/api/household/invitations/accept/route.ts.
// Keep this route so old links/clients do not break, but avoid maintaining
// two separate invitation acceptance implementations.

export { GET, POST } from "../../household/invitations/accept/route";
