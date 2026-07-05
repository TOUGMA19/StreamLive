export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le proxy universel détecte automatiquement les requêtes d'image via
// `request.nextUrl.pathname.includes("/image")` — on réexporte simplement
// les mêmes handlers pour éviter de dupliquer toute la logique anti-blocage.
export { GET, OPTIONS, HEAD } from "../route";
