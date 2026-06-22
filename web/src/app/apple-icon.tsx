import { ImageResponse } from "next/og";

// iOS home-screen icon. MUST be opaque + square (transparency renders black; iOS rounds corners
// itself, so no pre-rounding). 180×180 is the canonical apple-touch-icon size.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1d4068",
          backgroundImage:
            "linear-gradient(135deg, #1d4068 0%, #2b7bcc 28%, #6f6fa8 54%, #db5d09 80%, #f3700f 100%)",
          color: "#f7f5f1",
          fontSize: 116,
          fontWeight: 800,
          fontFamily: "sans-serif",
        }}
      >
        M
      </div>
    ),
    { ...size },
  );
}
