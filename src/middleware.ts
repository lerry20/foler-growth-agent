import { NextResponse, type NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (idx >= 0 && decoded.slice(idx + 1) === password) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="FOLER Pulse"' },
  });
}
