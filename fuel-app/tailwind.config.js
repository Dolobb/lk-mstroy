/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#5e6ad2", hover: "#6872e0", pressed: "#525dc0", soft: "rgba(94,106,210,0.10)", ring: "rgba(94,106,210,0.38)" },
        "on-primary": "#ffffff",
        canvas: "#ffffff",
        surface: { 1: "#f5f6f6", 2: "#f6f7f7", 3: "#eceef0", 4: "#e6e8ea" },
        ink: { 1: "#08090a", 2: "#62666d", 3: "#8a8f98" },
        hairline: { DEFAULT: "rgba(8,9,10,0.09)", strong: "rgba(8,9,10,0.15)", faint: "rgba(8,9,10,0.05)" },
        success: { DEFAULT: "#27a644", soft: "rgba(39,166,68,0.12)" },
        queued: { DEFAULT: "#b8791a", soft: "rgba(184,121,26,0.13)" },
        error: { DEFAULT: "#d23f34", soft: "rgba(210,63,52,0.10)" },
      },
      borderRadius: { pill: "6px", sm: "8px", md: "10px", lg: "14px", xl: "16px", "2xl": "20px", full: "9999px" },
      minHeight: { "tap-primary": "64px", "tap-secondary": "48px", "tap-min": "44px", "tap-key": "72px" },
      minWidth: { "tap-min": "44px" },
      letterSpacing: { tight: "-0.018em", uppr: "0.08em" },
      fontSize: {
        "display-2xl": ["72px", { lineHeight: "0.95", letterSpacing: "-0.018em" }],
        "display-xl": ["56px", { lineHeight: "0.98", letterSpacing: "-0.018em" }],
        "display-l": ["40px", { lineHeight: "1.0", letterSpacing: "-0.018em" }],
        title: ["28px", { lineHeight: "1.1", letterSpacing: "-0.018em" }],
        heading: ["22px", { lineHeight: "1.2" }],
        subheading: ["18px", { lineHeight: "1.3" }],
        body: ["18px", { lineHeight: "1.4" }],
        "body-sm": ["16px", { lineHeight: "1.4" }],
        caption: ["15px", { lineHeight: "1.35" }],
        label: ["13px", { lineHeight: "1.2", letterSpacing: "0.08em" }],
      },
    },
  },
  plugins: [],
};
