// The frame sizes offered by the Layout header's menu, in CSS pixels. Generic sizes come first; each
// device group runs from the smallest screen to the largest. Print sizes are in points (1/72 inch).
export const FRAME_PRESETS = [
  {
    label: "Common",
    presets: [
    { label: "Desktop", width: 1440, height: 900 },
    { label: "Laptop", width: 1280, height: 800 },
    { label: "Tablet", width: 768, height: 1024 },
    { label: "Mobile", width: 390, height: 844 },
    { label: "Android", width: 360, height: 800 },
    { label: "Wireframe", width: 1440, height: 1024 },
    ],
  },
  {
    label: "iPhone",
    presets: [
    { label: "iPhone SE", width: 375, height: 667 },
    { label: "iPhone 13 mini", width: 375, height: 812 },
    { label: "iPhone 16e", width: 390, height: 844 },
    { label: "iPhone 16", width: 393, height: 852 },
    { label: "iPhone 17", width: 402, height: 874 },
    { label: "iPhone 18 Pro", width: 402, height: 874 },
    { label: "iPhone Air", width: 420, height: 912 },
    { label: "iPhone 16 Plus", width: 430, height: 932 },
    { label: "iPhone 18 Pro Max", width: 440, height: 956 },
    { label: "iPhone Duo", width: 466, height: 678 },
    { label: "iPhone Duo unfolded", width: 890, height: 626 },
    ],
  },
  {
    label: "Android",
    presets: [
    { label: "Google Pixel 11 Pro", width: 410, height: 914 },
    { label: "Google Pixel 11", width: 412, height: 924 },
    { label: "Google Pixel 11 Pro XL", width: 448, height: 997 },
    { label: "Google Pixel 11 Pro Fold", width: 791, height: 820 },
    ],
  },
  {
    label: "Tablet",
    presets: [
    { label: "iPad mini 8.3″", width: 744, height: 1133 },
    { label: "iPad Air 11″", width: 820, height: 1180 },
    { label: "iPad Pro 11″", width: 834, height: 1210 },
    { label: "iPad Air 13″", width: 1024, height: 1366 },
    { label: "iPad Pro 13″", width: 1032, height: 1376 },
    { label: "Google Pixel Tablet", width: 1280, height: 800 },
    { label: "Surface Pro 11", width: 1440, height: 960 },
    ],
  },
  {
    label: "Laptop and desktop",
    presets: [
    { label: "MacBook Air", width: 1280, height: 832 },
    { label: "MacBook Pro 14″", width: 1512, height: 982 },
    { label: "MacBook Pro 16″", width: 1728, height: 1117 },
    { label: "HD", width: 1280, height: 720 },
    { label: "Full HD", width: 1920, height: 1080 },
    { label: "iMac 24″", width: 2240, height: 1260 },
    { label: "Studio Display 27″", width: 2560, height: 1440 },
    ],
  },
  {
    label: "Watch",
    presets: [
    { label: "Apple Watch 40mm", width: 162, height: 197 },
    { label: "Apple Watch 41mm", width: 176, height: 215 },
    { label: "Apple Watch 44mm", width: 184, height: 224 },
    { label: "Apple Watch 42mm", width: 187, height: 223 },
    { label: "Apple Watch 45mm", width: 198, height: 242 },
    { label: "Apple Watch 46mm", width: 208, height: 248 },
    { label: "Apple Watch Ultra 3", width: 211, height: 257 },
    ],
  },
  {
    label: "Social",
    presets: [
    { label: "Instagram square", width: 1080, height: 1080 },
    { label: "Instagram post", width: 1080, height: 1350 },
    { label: "Instagram story", width: 1080, height: 1920 },
    { label: "X post", width: 1200, height: 675 },
    { label: "X header", width: 1500, height: 500 },
    { label: "Facebook post", width: 1200, height: 630 },
    { label: "Facebook cover", width: 820, height: 312 },
    { label: "LinkedIn cover", width: 1584, height: 396 },
    { label: "YouTube thumbnail", width: 1280, height: 720 },
    { label: "Dribbble shot", width: 1600, height: 1200 },
    { label: "Open Graph image", width: 1200, height: 630 },
    ],
  },
  {
    label: "Slides",
    presets: [
    { label: "Slide 16:9", width: 1920, height: 1080 },
    { label: "Slide 4:3", width: 1024, height: 768 },
    ],
  },
  {
    label: "Print",
    presets: [
    { label: "A6", width: 297, height: 420 },
    { label: "A5", width: 420, height: 595 },
    { label: "A4", width: 595, height: 842 },
    { label: "Letter", width: 612, height: 792 },
    { label: "Tabloid", width: 792, height: 1224 },
    ],
  },
];
