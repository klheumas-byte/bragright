import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const tokens = readFileSync(new URL("styles/tokens.css", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");
const html = readFileSync(new URL("../index.html", root), "utf8");
const staticRedirects = readFileSync(new URL("../public/_redirects", root), "utf8");
const staticFallback = readFileSync(new URL("../public/404.html", root), "utf8");
const context = readFileSync(new URL("context/ThemeContext.jsx", root), "utf8");
const switcher = readFileSync(new URL("components/ThemeSwitcher.jsx", root), "utf8");
const trophy = readFileSync(new URL("components/TrophyWatermark.jsx", root), "utf8");
const matches = readFileSync(new URL("pages/MyMatches.jsx", root), "utf8");
const matchCard = readFileSync(new URL("components/RichMatchCard.jsx", root), "utf8");
const playerIdentity = readFileSync(new URL("components/PlayerIdentity.jsx", root), "utf8");
const matchPresentation = readFileSync(new URL("pages/matchPresentation.js", root), "utf8");
const dashboard = readFileSync(new URL("pages/Dashboard.jsx", root), "utf8");
const statCard = readFileSync(new URL("components/StatCard.jsx", root), "utf8");
const profileViewModel = readFileSync(new URL("pages/profileViewModel.js", root), "utf8");
const activity = readFileSync(new URL("pages/MyActivity.jsx", root), "utf8");
const profileHero = readFileSync(new URL("components/ProfileIdentityHeader.jsx", root), "utf8");
const submitMatch = readFileSync(new URL("pages/SubmitMatch.jsx", root), "utf8");
const main = readFileSync(new URL("main.jsx", root), "utf8");

test("dark and light Turquoise Arena tokens match the approved palette", () => {
  assert.match(tokens, /--app-background:\s*#0e1a24/);
  assert.match(tokens, /--surface-primary:\s*#162631/);
  assert.match(tokens, /--accent-primary:\s*#8d5cf6/);
  assert.match(tokens, /--accent-secondary:\s*#3b9eff/);
  assert.match(tokens, /--accent-orange:\s*#ff8a2a/);
  assert.match(tokens, /html\[data-theme="light"\][\s\S]*?--app-background:\s*#f2f7f7/);
  assert.match(tokens, /html\[data-theme="light"\][\s\S]*?--surface-primary:\s*#fffdfc/);
  assert.match(tokens, /html\[data-theme="light"\][\s\S]*?--accent-primary:\s*#009f96/);
});

test("Competitive Summary uses visible SVG icons instead of initial placeholders", () => {
  assert.match(statCard, /<SidebarIcon name=\{icon\}/);
  assert.match(statCard, /stat-card--\$\{tone\}/);
  assert.match(tokens, /--icon-primary:/);
  assert.match(tokens, /--icon-surface:/);
  assert.doesNotMatch(dashboard, /icon:\s*"(?:TM|WN|LS|DR|RK|PT|PM|WR)"/);
  assert.doesNotMatch(profileViewModel, /"(?:MP|WN|LS|DR|RK|PT|WR)"/);
});

test("startup applies a persisted effective theme before the application module", () => {
  assert.ok(html.indexOf("bragright_theme_preference") < html.indexOf('src="/src/main.jsx"'));
  assert.match(html, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(context, /matchMedia\(DARK_MODE_QUERY\)/);
  assert.match(context, /addEventListener\("change", handleChange\)/);
  assert.match(context, /localStorage\.setItem\(THEME_STORAGE_KEY, normalized\)/);
});

test("published nested routes recover through the SPA entry point", () => {
  assert.match(main, /import \{ HashRouter \} from "react-router-dom"/);
  assert.match(main, /<HashRouter>/);
  assert.doesNotMatch(main, /BrowserRouter/);
  assert.match(staticRedirects, /\/\*\s+\/index\.html\s+200/);
  assert.match(staticFallback, /__bragright_spa_path/);
  assert.match(staticFallback, /location\.replace/);
  assert.match(html, /history\.replaceState\(null, "", `\/#\$\{recoveryPath\}`\)/);
  assert.ok(html.indexOf("recoveryPath") < html.indexOf('src="/src/main.jsx"'));
});

test("theme controls expose Light, Dark, and System accessibly", () => {
  assert.match(switcher, /aria-haspopup="menu"/);
  assert.match(switcher, /role="menuitemradio"/);
  assert.match(switcher, /role="radiogroup"/);
  assert.match(switcher, /value: "light"/);
  assert.match(switcher, /value: "dark"/);
  assert.match(switcher, /value: "system"/);
  assert.match(switcher, /event\.key === "Escape"/);
});

test("the original trophy is decorative and cannot block interaction", () => {
  assert.match(trophy, /aria-hidden="true"/);
  assert.match(trophy, /focusable="false"/);
  assert.match(css, /\.trophy-watermark\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(matches, /<TrophyWatermark \/>/);
});

test("Match Center preserves its route while using orange challenge styling", () => {
  assert.match(matches, /to="\/dashboard\/submit-match" variant="challenge"/);
  assert.match(matches, /StatusPill label="Completed Matches"/);
  assert.match(css, /\.match-view-tab-active/);
  assert.match(css, /--accent-primary/);
});

test("reference Match Center details are present with real-data bindings", () => {
  assert.match(matches, /Every Match\. Every Moment\./);
  assert.match(matches, /<span>Brag Right\.<\/span>/);
  assert.match(matches, /StatusPill label="Needs Attention"[\s\S]*?viewCounts\.attention/);
  assert.match(matches, /StatusPill label="Active Matches"[\s\S]*?viewCounts\.active/);
  assert.match(matches, /StatusPill label="Completed Matches"[\s\S]*?viewCounts\.completed/);
  assert.match(matches, /StatusPill label="Disputed Matches"[\s\S]*?viewCounts\.disputed/);
  assert.match(matches, /title="Match statistics"/);
  assert.match(matches, /<CompetitiveSummary stats=\{competitiveStats\}/);
  assert.match(matches, /competitiveStats\.map\(\(stat\)/);
  assert.match(matches, /role="tablist"/);
  assert.match(matches, /role="tab"/);
  assert.match(matchPresentation, /id: "all"[\s\S]*?id: "attention"[\s\S]*?id: "active"[\s\S]*?id: "completed"[\s\S]*?id: "disputed"/);
});

test("match cards render You versus Opponent with avatars, metrics, status, and more details", () => {
  assert.match(matchCard, /participant\.perspectiveLabel/);
  assert.match(matchCard, /rich-match-versus__marker">VS/);
  assert.match(matchCard, /<PlayerIdentity/);
  assert.match(playerIdentity, /getIdentityBadges/);
  assert.match(matchCard, /name="crown"/);
  assert.match(matchCard, /view\.status\.label/);
  assert.match(matchCard, /View match/);
  assert.doesNotMatch(matchCard, /Detective-D|ShadowStrike/);
});

test("priority pages reuse the My Matches arena motifs and icon system", () => {
  assert.match(dashboard, /<TrophyWatermark className="arena-hero-watermark" \/>/);
  assert.match(dashboard, /<SidebarIcon name=\{pendingActions\.length \? "clock" : "matches"\}/);
  assert.match(activity, /className="arena-hero-icon"/);
  assert.match(activity, /variant="challenge"/);
  assert.match(profileHero, /className="profile-hero-motif"/);
  assert.match(css, /My Matches-derived product-wide arena language/);
});

test("global motion is restrained, theme-aware, and reduced-motion safe", () => {
  assert.match(context, /classList\.add\("theme-transition"\)/);
  assert.match(css, /@keyframes arena-enter/);
  assert.match(css, /@keyframes arena-card-enter/);
  assert.match(css, /@keyframes arena-pop/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important/);
});

test("Submit Match opponent cards preserve readable identities and obvious selection", () => {
  assert.match(submitMatch, /<PlayerIdentity[\s\S]*?player=\{player\}/);
  assert.match(submitMatch, /variant="compact"/);
  assert.match(submitMatch, /name="check" decorative/);
  assert.match(css, /html\[data-theme="light"\] \.opponent-option-card[\s\S]*?background: #f9fcfd[\s\S]*?color: #163047/);
  assert.match(css, /html\[data-theme="dark"\] \.opponent-option-card[\s\S]*?background: #19303b[\s\S]*?color: #f5fbff/);
  assert.match(css, /\.opponent-option-card:focus-visible/);
  assert.match(css, /\.opponent-option-card\.opponent-option-selected/);
});
