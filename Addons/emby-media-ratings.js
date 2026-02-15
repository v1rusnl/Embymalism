// ===========================================================================
// Emby Rating Colors -> THX to https://github.com/n00bcodr/Jellyfin-Enhanced
// Detects international content ratings and colorizes them automatically.
// Copy script inside /system/dashboard-ui/ and add <script src="emby-media-ratings.js" defer></script> in index.html before </body>
// ===========================================================================
(function () {
  "use strict";
  // =========================================================================
  //  CUSTOMIZABLE COLORS — [Background, Border]
  //  These values can be changed as desired.
  // =========================================================================
  const COLORS = {
    green:     ["#2E7D32", "transparent"], // e.g. Border Color #4CAF50 - General / All Audiences
    yellow:    ["#daa520", "transparent"], // e.g. Border Color #FFC107 - Parental Guidance Suggested
    orange:    ["#E65100", "transparent"], // e.g. Border Color #FF9800 - Ages 12/13+ — Parents Strongly Cautioned
    redOrange: ["#ff0000", "transparent"], // e.g. Border Color #FF5722 - Ages 16+ — Mature / Restricted
    red:       ["#800000", "transparent"], // e.g. Border Color #cc2222 - Ages 18+ — Adults Only
    pink:      ["#880E4F", "transparent"], // e.g. Border Color #C2185B - Strictly 18+ / Adults Only
    purple:    ["#6A1B9A", "transparent"], // e.g. Border Color #8953aa - Special Category
    blue:      ["#1565C0", "transparent"], // e.g. Border Color #2196F3 - Educational / Exempt
    grey:      ["#616161", "transparent"], // e.g. Border Color #9E9E9E - Unrated
  };
  // =========================================================================
  //  RATING → COLOR GROUP  (all countries from the Jellyfin template)
  // =========================================================================
  const GROUPS = {
    green: [
      // 🇦🇷 AR  🇦🇺 AU  🇦🇹 AT  🇧🇪 BE  🇧🇷 BR  🇨🇦 CA  🇨🇭 CH  🇨🇳 CN  🇨🇿 CZ
      // 🇩🇰 DK  🇫🇮 FI  🇫🇷 FR  🇩🇪 DE  🇬🇷 GR  🇭🇺 HU  🇮🇳 IN  🇮🇩 ID  🇮🇪 IE
      // 🇮🇱 IL  🇮🇹 IT  🇯🇵 JP  🇰🇷 KR  🇲🇾 MY  🇲🇽 MX  🇳🇱 NL  🇳🇿 NZ  🇳🇴 NO
      // 🇵🇭 PH  🇵🇱 PL  🇵🇹 PT  🇷🇺 RU  🇸🇬 SG  🇿🇦 ZA  🇪🇸 ES  🇸🇪 SE  🇹🇭 TH
      // 🇹🇷 TR  🇬🇧 GB/UK  🇺🇸 US  🇻🇳 VN
      "AR-ATP","AU-C","AU-G","AU-P","P","AT-0","BE-KT","BR-L","C8","CA-C",
      "CA-C8","CA-G","C","CH-0","CN-G","CZ-U","DK-A","FI-S","FR-U","DE-0",
      "FSK-0","GR-K","HU-KN","IN-U","U","ID-SU","IE-G","G","IL-G","IT-T",
      "JP-G","KR-ALL","MY-U","MX-AA","NL-AL","NZ-G","NO-6","NO-A","PH-G",
      "PL-B/O","PT-M/4","RU-0+","SG-G","ZA-A","ES-APTA","SE-BTL","TH-G",
      "TR-G","GB-U","UK-U","APPROVED","PASSED","TV-G","TV-Y","TV-Y7","VN-P"
    ],
    yellow: [
      "AR-13","AU-PG","PG","AT-6","BE-6","BR-12","CA-PG","CH-6","CZ-12",
      "DK-7","FI-K-7","FR-10","FR--10","DE-6","FSK-6","GR-K-12","HU-6",
      "IN-UA","IN-UA-7","IN-U/A 7+","IN-UA-13","IN-U/A 13+","IN-UA-16",
      "IN-U/A 16+","ID-BO","IE-PG","IE-12","IE-12A","12A","IL-PG","IT-VM6",
      "JP-PG12","KR-12","MY-P13","MX-A","NL-6","NZ-PG","NO-9","NO-12",
      "PH-PG","PL-7","PT-M/6","RU-6+","SG-PG","ZA-PG","ES-7","SE-7",
      "TH-PG13","TR-PG","GB-PG","GB-12","GB-12A","UK-PG","UK-12","UK-12A",
      "12","TV-PG","GP","10"
    ],
    orange: [
      "AR-16","AU-M","M","AT-10","BE-9","BR-14","14+","CA-14+","CA-13+",
      "CH-10","CN-PG-13","CZ-15","DK-11","FI-K-12","FR-12","FR--12","DE-12",
      "FSK-12","GR-K-15","HU-12","ID-13+","IE-15A","15A","IL-14","IT-VM14",
      "JP-R15+","KR-15","MX-B","NL-9","NZ-M","NO-15","PH-PG-13","PL-12",
      "PT-M/12","RU-12+","SG-PG13","ZA-10-12PG","ES-12","SE-11","TH-15",
      "TR-12","GB-15","UK-15","15","PG-13","TV-14","VN-T13","-12"
    ],
    redOrange: [
      "MA15+","AU-MA15+","AT-14","BE-12","BR-16","CA-16+","CH-14","FI-K-16",
      "FR-16","FR--16","DE-16","FSK-16","HU-16","ID-17+","IE-16","IL-16",
      "MX-B15","NL-12","NZ-R13","PH-R-16","PL-15","PT-M/16","RU-16+",
      "SG-NC16","ZA-13","ES-16","SE-15","TR-15","VN-T16","16+","MA 15+",
      "16","-16","M16"
    ],
    red: [
      "AR-18","AU-R18+","R18+","AT-16","BE-16","BR-18","18+","CA-18+",
      "CH-16","CN-R","CZ-18","DK-15","FI-K-18","FR-18","FR--18","DE-18",
      "FSK-18","GR-K-17","HU-18","IN-A","ID-21+","IE-18","18","IL-18",
      "IT-VM18","JP-R18+","KR-19","KR-R","MY-18","MX-C","NL-16","NZ-R15",
      "NZ-R16","NO-18","PH-R-18","PL-18","PT-M/18","RU-18+","SG-M18",
      "ZA-16","ES-18","TH-18","TR-18","GB-18","UK-18","R","TV-MA"
    ],
    pink: [
      "AU-X18+","X18+","CH-18","MX-D","NZ-R18","SG-R21","ZA-18","TH-20",
      "GB-R18","UK-R18","R18","NC-17","X"
    ],
    purple: ["IN-S"],
    blue:   ["EXEMPT","EDUCATIONAL","INFORMATIONAL"],
    grey:   ["UNRATED","NOT RATED","NR","UR","NONE"]
  };
  // =========================================================================
  //  BUILD LOOKUP MAP  (Rating text → color group)
  //  Later groups override earlier ones on duplicates (like CSS cascade)
  // =========================================================================
  const MAP = {};
  Object.entries(GROUPS).forEach(function (e) {
    e[1].forEach(function (r) { MAP[r.toUpperCase()] = e[0]; });
  });
  // =========================================================================
  //  INJECT CSS
  // =========================================================================
  var css =
    '.mediaInfoItem[data-rating-group]{' +
      'color:#fff!important;' +
      'text-align:center!important;text-transform:uppercase!important;' +
      'text-shadow:0 0 2px rgba(0,0,0,.8)!important;' +
      'border-radius:4px!important;border:1px solid rgba(255,255,255,.2)!important;' +
      'padding:1px 6px!important;min-width:20px!important;' +
      'line-height:1.2!important;' +
      'display:inline-block!important;transition:all .2s ease!important}' +
    '.mediaInfoItem[data-rating-group]:hover{' +
      'transform:scale(1.05)!important;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.3)!important}';
  Object.entries(COLORS).forEach(function (e) {
    css += '.mediaInfoItem[data-rating-group="' + e[0] + '"]{' +
      'background:' + e[1][0] + '!important;' +
      'border-color:' + e[1][1] + '!important}';
  });
  css +=
    '@media(prefers-reduced-motion:reduce){' +
      '.mediaInfoItem[data-rating-group]{transition:none!important}' +
      '.mediaInfoItem[data-rating-group]:hover{transform:none!important}}';
  var styleEl = document.createElement("style");
  styleEl.id = "emby-rating-colors";
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
  // =========================================================================
  //  DETECT AND TAG RATINGS
  // =========================================================================
  function processRatings() {
    document.querySelectorAll(".mediaInfoItem:not([data-rp])").forEach(function (el) {
      el.setAttribute("data-rp", "");
      var text = el.textContent.trim().toUpperCase();
      var group = MAP[text];
      if (group) el.setAttribute("data-rating-group", group);
    });
  }
  new MutationObserver(processRatings).observe(document.body, {
    childList: true,
    subtree: true
  });
  processRatings();
})();