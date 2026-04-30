# COHESION Analysis: Setup & Deployment Guide

**COHESION** is a Gaelic Football event analysis dashboard built with:
- **Frontend:** HTML5 + vanilla JavaScript
- **Database:** Supabase PostgreSQL
- **Auth:** Netlify Identity
- **Hosting:** Netlify (static site + serverless functions)

---

## Quick Start

### Prerequisites
- Node.js 18+ (for local development)
- Netlify CLI: `npm install -g netlify-cli`
- Supabase account
- Netlify account

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/barrymcguire-mayogaa/cohesion-analysis.git
   cd cohesion-analysis
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Fill in your Supabase & Netlify credentials in `.env.local`

4. **Run locally**
   ```bash
   npm run dev
   ```
   Opens at `http://localhost:8888` with Netlify Functions available at `/.netlify/functions/`

5. **Open the app**
   - **Admin:** https://localhost:8888/admin.html (login required)
   - **Library:** https://localhost:8888/library.html
   - **Dashboard:** https://localhost:8888/dashboard.html

---

## Configuration

### 1. Supabase Setup

#### Get Your Credentials
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your `cohesion-analysis` project
3. Go to **Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** → `SUPABASE_KEY`
   - **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY` (Netlify only!)

#### Initialize Database
The database schema is defined in `supabase/migrations/`:

1. **Option A: Apply migrations in Supabase UI**
   - Go to **SQL Editor**
   - Open `supabase/migrations/001_initial_schema.sql`
   - Run it
   - Then run `supabase/migrations/002_enable_rls.sql`

2. **Option B: Use Supabase CLI** (advanced)
   ```bash
   supabase migration up
   ```

#### What These Migrations Do
- **001_initial_schema.sql**: Creates `games` and `events` tables
- **002_enable_rls.sql**: Enables Row-Level Security policies
  - Public can **read** all data
  - Only authenticated **admin** users can **write** data
  - Blocks anon key from modifying data (security fix!)

### 2. Netlify Identity Setup

#### Configure Authentication
1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Select site `cohesion-team-analysis`
3. Go to **Site settings → Identity**
4. Click **Enable Identity**
5. Configure providers (Email + Password is default)

#### Create Admin User
1. In **Identity** section, click **Invite users**
2. Add your email: `barrymcguire18@hotmail.com`
3. Go to **Roles** tab
4. Create a role called `admin`
5. Assign your user to the `admin` role

#### Set Environment Variables
These are critical for Netlify Functions to work:

1. Go to **Site settings → Build & deploy → Environment**
2. Add these variables:
   ```
   SUPABASE_URL = https://your-project.supabase.co
   SUPABASE_KEY = eyJhbGci...
   SUPABASE_SERVICE_ROLE_KEY = eyJhbGci... (the SECRET key, not public!)
   ```

### 3. GitHub & Git

#### First-Time Setup
```bash
git remote add origin https://github.com/barrymcguire-mayogaa/cohesion-analysis.git
git branch -M main
git push -u origin main
```

#### Ongoing Development
```bash
# See what changed
git status

# Commit changes
git add .
git commit -m "Describe what you changed"

# Push to GitHub (auto-deploys to Netlify)
git push origin main
```

#### Never Commit Secrets!
The `.gitignore` file already protects:
- `.env` files (never committed)
- `node_modules/` (reinstalled on deploy)

---

## How It Works: Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER (Client-Side)                 │
│  admin.html / library.html / dashboard.html                  │
│  - Parses XML files                                          │
│  - Displays UI                                               │
│  - Uses anon Supabase key (read-only via RLS)               │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ (1) Authenticated admin uploads game
                  ↓
        ┌─────────────────────────┐
        │  Netlify Identity       │
        │  Validates login        │
        │  Issues JWT token       │
        │  (contains role=admin)  │
        └────────────┬────────────┘
                     │
                     │ (2) Browser calls Netlify Function
                     ↓
        ┌──────────────────────────────────────┐
        │  /.netlify/functions/processGame.js  │
        │  - Validates JWT token               │
        │  - Checks role = 'admin'             │
        │  - Parses XML (if needed)            │
        │  - Atomically deletes old events     │
        │  - Inserts new events (in chunks)    │
        │  - Updates game metadata             │
        └────────────┬─────────────────────────┘
                     │
                     │ (3) Function calls Supabase
                     │    (uses protected service key)
                     ↓
        ┌──────────────────────────────────────┐
        │  Supabase PostgreSQL                 │
        │  - RLS policies enforce authorization│
        │  - games table                       │
        │  - events table (ON DELETE CASCADE)  │
        └──────────────────────────────────────┘
                     │
                     │ (4) Function returns result
                     ↓
        ┌──────────────────────────────────────┐
        │  Browser displays success/error      │
        │  Library/Dashboard auto-refresh      │
        │  (via Supabase real-time)            │
        └──────────────────────────────────────┘
```

### Security Model

| Component | Key Used | Permissions |
|-----------|----------|-------------|
| **Browser (dashboard/library)** | anon key | SELECT only (public read) |
| **Browser (admin.html, logged in)** | anon key | SELECT only (RLS blocks writes) |
| **Netlify Function** | service_role key | Full access (bypasses RLS) |
| **Netlify Function** | JWT from Netlify Identity | Validates user is admin |

**Key insight:** All writes go through Netlify Functions (server-side), never direct browser writes. This is why the service role key is protected.

---

## Deployment

### Automatic (Recommended)
Every `git push` to main triggers automatic deploy:
1. GitHub notifies Netlify
2. Netlify builds the site (just copies static files)
3. Netlify deploys to CDN
4. Site updates at https://cohesion-team-analysis.netlify.app

### Manual Rebuild
If you need to redeploy without code changes:
1. Go to Netlify dashboard
2. Site: `cohesion-team-analysis`
3. **Deploys** tab
4. Click **Trigger deploy** → **Deploy site**

### Check Deployment Status
```bash
# See recent commits
git log --oneline -5

# Check if deployed
# (look for green checkmark on https://app.netlify.com)
```

---

## Troubleshooting

### Login Not Working
- Check Netlify Identity is **enabled** (Site settings → Identity)
- Verify your email is in the **Users** list
- Check you have the **admin** role assigned
- Try incognito mode (cache issue)

### Can't Upload Games
- Verify you're logged in as **admin** (not just any user)
- Check browser console for errors (`F12` → Console tab)
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set in Netlify environment

### Netlify Functions Errors
- Check `/.netlify/functions/processGame.js` exists
- Check environment variables in Netlify dashboard
- View function logs: **Functions** tab in Netlify dashboard

### Database Schema Issues
- Go to Supabase **SQL Editor**
- Run: `SELECT * FROM games LIMIT 1;`
- If error, run migrations again (001, then 002)

### RLS Policy Blocking Access
- Go to Supabase **Authentication → Users**
- Confirm user exists and has role
- Check RLS policies in **SQL Editor → Policies** tab

---

## Development Commands

```bash
# Install dependencies
npm install

# Run locally (with Netlify Functions)
npm run dev

# Check data integrity
npm run check:data

# Deploy (via git push, not manual)
git push origin main
```

---

## File Structure

```
cohesion-analysis/
├── admin.html                      # Admin panel (upload, edit, delete)
├── library.html                    # Game library
├── dashboard.html                  # Event analysis dashboard
├── index.html                      # Login page
├── Assets/                         # Images (pitch diagrams, etc.)
├── games/                          # Game JSON files (auto-generated)
├── netlify/
│   └── functions/
│       ├── auth.js                 # Password auth (legacy, unused)
│       └── processGame.js          # NEW: Secure game processing
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql  # NEW: Create tables
│       └── 002_enable_rls.sql      # NEW: Add RLS policies
├── .gitignore                      # (updated) Ignore node_modules, .env
├── .env.example                    # NEW: Environment template
├── package.json                    # (updated) Add scripts
├── SETUP.md                        # This file
└── netlify.toml                    # Netlify configuration
```

---

## Next Steps

1. ✅ Complete the configuration above
2. ✅ Test login via admin.html
3. ✅ Upload a test game
4. ✅ Verify events appear in dashboard
5. 📋 Implement bulk upload (will use processGame function)

---

## Questions?

- **Supabase docs:** https://supabase.com/docs
- **Netlify docs:** https://docs.netlify.com
- **Netlify Identity:** https://docs.netlify.com/security/secure-access-to-sites/identity

