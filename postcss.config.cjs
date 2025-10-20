// PostCSS config intentionally minimal.
// Tailwind v4 directives are expanded via the prebuild snapshot script
// (yarn tailwind:generate) into styles.tailwind.css which Angular consumes.
// Keeping this empty avoids invoking Tailwind twice and reduces build ambiguity.
module.exports = {
  plugins: []
};
