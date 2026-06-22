import { ImageResponse } from "next/og";

// The app icon IS the brand mark: the blue→orange gradient = the two load channels (the logo).
// Full-bleed, opaque, centred glyph well inside the maskable safe zone → works for any + maskable.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 320,
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
