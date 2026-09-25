/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#161B22",
        paper: "#F6F7FB",
        surface: "#FFFFFF",
        navy: {
          50: "#EEF2F8",
          100: "#D7E1EE",
          300: "#7C93B4",
          500: "#3C567F",
          700: "#22385C",
          900: "#152540",
        },
        rescue: {
          50: "#FFF3E9",
          100: "#FFE1C4",
          300: "#F5A85A",
          500: "#E8873A",
          700: "#C2661F",
        },
        ok: {
          50: "#EAF7EF",
          300: "#7FCBA0",
          500: "#2F9E68",
          700: "#1F7A50",
        },
        warn: {
          50: "#FFF6E5",
          500: "#D9971C",
        },
        danger: {
          50: "#FCEBEB",
          500: "#D64545",
        },
      },
      fontFamily: {
        display: ["Sora", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(21, 37, 64, 0.06), 0 1px 0 rgba(21, 37, 64, 0.04)",
      },
      borderRadius: {
        xl2: "0.875rem",
      },
    },
  },
  plugins: [],
};
