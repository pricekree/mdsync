# Publishing MD Sync

---

## Before you publish

### 1. Prerequisites checklist

| Item | Status / action |
|------|-----------------|
| **Publisher ID** | Register at [Marketplace management](https://marketplace.visualstudio.com/manage) |
| **`package.json` → `publisher`** | Must match your registered publisher ID exactly |
| **`README.md`** | Extension listing page (already included) |
| **Version** | Bump `"version"` in `package.json` for each release |
| **Icon** (recommended) | 128×128 PNG, add `"icon": "media/icon.png"` to `package.json` |
| **Repository** (recommended) | Add `"repository"` field if hosting source internally |

### 2. Update `package.json` for publishing

```json
{
  "publisher": "your-registered-publisher-id",
  "license": "SEE LICENSE IN LICENSE",
  "repository": {
    "type": "git",
    "url": "https://your-internal-git/mdsync"
  }
}
```

### 3. Choose distribution model

| Model | Best for | Notes |
|-------|----------|-------|
| **VSIX manual install** | Internal pilots, small teams | What you use today; no Marketplace account needed |
| **Private extension (org)** | Company-wide internal rollout | Requires Azure DevOps / GitHub org + VS Code policy; extensions not public |
| **Public Marketplace** | Open distribution | **Not typical for proprietary internal tools** — code and listing are public unless you use a private offer |

---

## Part A — Package a VSIX (internal install)

Use this for daily internal distribution without the public Marketplace.

### Step 1: Install dependencies

```bash
cd /path/to/mdsync
npm install
```

### Step 2: Compile

```bash
npm run compile
```

### Step 3: Package

```bash
npx vsce package --allow-missing-repository
```

Output: `mdsync-<version>.vsix` in the project root.

### Step 4: Distribute

Share the `.vsix` via internal file share, email, or software portal.

### Step 5: Install on a user's machine

**VS Code UI:** Extensions → `⋯` → **Install from VSIX...** → select the file.

**Command line:**

```bash
code --install-extension mdsync-0.1.0.vsix
```

### Step 6: Update an existing install

1. Bump `version` in `package.json`
2. Re-run compile + package
3. Users install the new `.vsix` (uninstall old version first if needed)

---

## Part B — Publish to the VS Code Marketplace

### Step 1: Create a Microsoft account

Use a corporate Microsoft account if your org requires it.

### Step 2: Create a publisher

1. Open [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Sign in
3. Click **Create publisher**
4. Choose a unique **Publisher ID**
5. Enter display name and contact details

### Step 3: Create a Personal Access Token (PAT)

1. Go to [https://dev.azure.com](https://dev.azure.com) (create an org if prompted — name does not affect publishing)
2. User settings (avatar) → **Personal access tokens**
3. **+ New Token**
4. Name: e.g. `vsce-mdsync-publish`
5. Organization: **All accessible organizations**
6. Expiration: set per your security policy
7. Scopes: **Custom defined** → **Marketplace** → **Manage**
8. Create and **copy the token** (shown once)

### Step 4: Log in with vsce

```bash
npx vsce login <your-publisher-id>
```

Paste the PAT when prompted.

### Step 5: Pre-publish checks

```bash
npm run compile
npx vsce ls          # preview files included in package
npx vsce package     # test local package first
```

Fix `.vscodeignore` to exclude dev files (`src/`, `.vscode/`, `.cursor/`, `sample.md`) before publishing to reduce package size.

### Step 6: Publish

```bash
npx vsce publish --allow-missing-repository
```

Or publish an existing VSIX without repackaging:

```bash
npx vsce publish --packagePath mdsync-0.1.0.vsix
```

### Step 7: Verify listing

1. Open `https://marketplace.visualstudio.com/items?itemName=<publisher>.mdsync`
2. Confirm README, version, and description appear correctly

### Step 8: Publish updates

1. Bump `"version"` in `package.json` (semver: `0.1.1`, `0.2.0`, etc.)
2. Run `npx vsce publish` again

---

## Part C — Recommended `.vscodeignore` for production packages

Add dev-only paths so the VSIX stays small:

```
.vscode/**
src/**
tsconfig.json
**/*.ts
**/*.map
.git/**
.cursor/**
sample.md
*.vsix
**/.DS_Store
```

Keep `out/`, `media/`, `node_modules/` (or bundle dependencies and exclude `node_modules/`).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ERROR publisher 'mdsync' not found` | Register publisher or change `publisher` in `package.json` |
| `No README available` in extension details | Add `README.md` and repackage |
| VSIX missing `out/` | Remove `out` from `.vscodeignore` |
| Extension fails after install | Ensure `node_modules` is packaged or bundle with esbuild |
| `vsce` secret scan error | Run outside restricted sandbox; update `@vscode/vsce` |
| PAT rejected | Regenerate with **Marketplace → Manage** scope only |

---

## Quick reference commands

```bash
# Local VSIX
npm run compile && npx vsce package --allow-missing-repository

# Login (once per machine / token expiry)
npx vsce login <publisher-id>

# Publish to Marketplace
npx vsce publish --allow-missing-repository

# Install locally
code --install-extension mdsync-0.1.0.vsix
```

---