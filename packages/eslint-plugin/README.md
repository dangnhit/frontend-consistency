# @frontend-consistency/eslint-plugin

ESLint rules (`fcs/*`) for a [frontend-consistency](https://github.com/dangnhit/frontend-consistency) design contract.
Severities and params come from `.design/`, not from the ESLint config.

```js
// eslint.config.mjs
import fcs from "@frontend-consistency/eslint-plugin";
export default [...nextConfig, ...fcs.config()];
```

Rules: `no-raw-textarea`, `no-ad-hoc-loading`, `page-template`, `page-header`, `no-disable`. Usually installed by
`npx fcs init`.
