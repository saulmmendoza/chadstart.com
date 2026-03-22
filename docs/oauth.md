---
id: oauth
title: OAuth / Social Login
description: Add "Login with Google", "Login with GitHub", and 200+ other OAuth providers to your ChadStart app in minutes.
---

# OAuth / Social Login

## Introduction

ChadStart supports **OAuth / Social Login** via the [grant](https://www.npmjs.com/package/grant) library, giving you access to **200+ OAuth providers** out of the box. Users can sign in with their existing accounts on platforms like Google, GitHub, Facebook, Discord, and many more — no custom OAuth flow code required.

When a user logs in via an OAuth provider, ChadStart will:

1. Redirect the user to the provider's authorization page.
2. Handle the callback and extract the user's profile.
3. Find an existing user by email or create a new one in your authenticable entity.
4. Return a **JWT token** (same format as email/password login).

!!! info
    OAuth secrets (**client IDs** and **client secrets**) must always be stored in environment variables — never in your YAML config file.

## Quick Start

### 1. Register your app with the provider

Visit the provider's developer console and create an OAuth application. You will receive a **Client ID** (key) and **Client Secret**.

Set the **Redirect URI** (callback URL) to:

```
https://your-domain.com/connect/<provider>/callback
```

For local development:

```
http://localhost:3000/connect/<provider>/callback
```

### 2. Set environment variables

```bash
# .env
OAUTH_GOOGLE_KEY=your-google-client-id
OAUTH_GOOGLE_SECRET=your-google-client-secret
```

The pattern is always `OAUTH_<PROVIDER>_KEY` and `OAUTH_<PROVIDER>_SECRET` where `<PROVIDER>` is the provider name in **UPPERCASE**.

### 3. Add OAuth config to your YAML

```yaml
oauth:
  entity: User                    # Which authenticable entity to use
  successRedirect: /dashboard     # Where to redirect after login
  providers:
    google:
      scope:
        - openid
        - email
        - profile
```

### 4. Add a login button

```html
<a href="/connect/google">Login with Google</a>
```

That's it! ChadStart handles the entire OAuth dance automatically.

## Configuration Reference

The `oauth` section in your YAML config supports the following options:

```yaml
oauth:
  # Target authenticable entity for OAuth users.
  # Default: first authenticable entity in your config.
  entity: User

  # Redirect URL after successful login (?token=JWT is appended).
  # If omitted, returns JSON: { token, user }
  successRedirect: /dashboard

  # Redirect URL on error (?error=message is appended).
  # If omitted, returns JSON: { error }
  errorRedirect: /login?error=true

  # Default settings for all providers
  defaults:
    transport: querystring

  # Provider configurations
  providers:
    google:
      scope:
        - openid
        - email
        - profile
```

### Provider Options

Each provider entry supports these options:

| Option | Type | Description |
|--------|------|-------------|
| `scope` | `string` or `string[]` | OAuth scopes to request |
| `callback` | `string` | Custom callback URL (default: `/api/auth/oauth/callback`) |
| `custom_params` | `object` | Extra query parameters for the authorization URL |
| `subdomain` | `string` | Required by some providers (e.g., Shopify) |
| `nonce` | `boolean` | Enable nonce generation (some OIDC providers) |
| `pkce` | `boolean` | Enable PKCE for enhanced security |
| `response` | `string[]` | Data to include in callback (e.g., `['tokens', 'profile']`) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OAUTH_<PROVIDER>_KEY` | Client/App ID for the provider |
| `OAUTH_<PROVIDER>_SECRET` | Client/App Secret for the provider |
| `BASE_URL` | Your application's public URL (used to build redirect URIs) |

## API Endpoints

Once OAuth is configured, the following endpoints are available:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/connect/<provider>` | Initiates the OAuth flow (redirects to provider) |
| `GET` | `/api/auth/oauth/callback` | OAuth callback (handled automatically) |
| `GET` | `/api/auth/oauth/providers` | Lists configured provider names |

### Example: List providers

```http
GET /api/auth/oauth/providers
```

```json
{
  "providers": ["google", "github", "discord"]
}
```

## Top 20 Provider Setup Guides

Below are setup guides for the 20 most popular OAuth providers. For each one, you need to:

1. Create an app on the provider's developer portal
2. Set the redirect URI to `https://your-domain.com/connect/<provider>/callback`
3. Add the client ID and secret to your `.env` file
4. Add the provider to your YAML config

---

### 1. Google

**Developer Console:** [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)

1. Create a project → **APIs & Services** → **Credentials** → **Create OAuth Client ID**
2. Set application type to **Web application**
3. Add authorized redirect URI: `http://localhost:3000/connect/google/callback`

```bash
OAUTH_GOOGLE_KEY=your-client-id.apps.googleusercontent.com
OAUTH_GOOGLE_SECRET=your-client-secret
```

```yaml
oauth:
  providers:
    google:
      scope:
        - openid
        - email
        - profile
      custom_params:
        access_type: offline    # Get a refresh token
```

---

### 2. GitHub

**Developer Settings:** [github.com/settings/developers](https://github.com/settings/developers)

1. Go to **Settings** → **Developer Settings** → **OAuth Apps** → **New OAuth App**
2. Set the callback URL: `http://localhost:3000/connect/github/callback`

```bash
OAUTH_GITHUB_KEY=your-github-client-id
OAUTH_GITHUB_SECRET=your-github-client-secret
```

```yaml
oauth:
  providers:
    github:
      scope:
        - user:email
        - read:user
```

---

### 3. Facebook

**Developer Portal:** [developers.facebook.com](https://developers.facebook.com/apps/)

1. Create a new app → **Facebook Login** → **Settings**
2. Add valid redirect URI: `http://localhost:3000/connect/facebook/callback`

```bash
OAUTH_FACEBOOK_KEY=your-facebook-app-id
OAUTH_FACEBOOK_SECRET=your-facebook-app-secret
```

```yaml
oauth:
  providers:
    facebook:
      scope:
        - email
        - public_profile
```

---

### 4. Discord

**Developer Portal:** [discord.com/developers](https://discord.com/developers/applications)

1. Create a new application → **OAuth2** → **General**
2. Add redirect: `http://localhost:3000/connect/discord/callback`

```bash
OAUTH_DISCORD_KEY=your-discord-client-id
OAUTH_DISCORD_SECRET=your-discord-client-secret
```

```yaml
oauth:
  providers:
    discord:
      scope:
        - identify
        - email
```

---

### 5. Apple

**Developer Portal:** [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list/serviceId)

1. Register a **Services ID** and configure **Sign In with Apple**
2. Set the redirect URL: `https://your-domain.com/connect/apple/callback`

!!! warning
    Apple requires HTTPS even for development.

```bash
OAUTH_APPLE_KEY=your-apple-services-id
OAUTH_APPLE_SECRET=your-apple-client-secret
```

```yaml
oauth:
  providers:
    apple:
      scope:
        - name
        - email
      nonce: true
```

---

### 6. Microsoft

**Azure Portal:** [portal.azure.com](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)

1. Register a new application → **Authentication** → **Add a platform** → **Web**
2. Set redirect URI: `http://localhost:3000/connect/microsoft/callback`

```bash
OAUTH_MICROSOFT_KEY=your-application-client-id
OAUTH_MICROSOFT_SECRET=your-client-secret-value
```

```yaml
oauth:
  providers:
    microsoft:
      scope:
        - openid
        - email
        - profile
```

---

### 7. Twitter (X)

**Developer Portal:** [developer.twitter.com](https://developer.twitter.com/en/portal/projects-and-apps)

1. Create a project and app → **User authentication settings** → **Edit**
2. Set the callback URL: `http://localhost:3000/connect/twitter/callback`

```bash
OAUTH_TWITTER_KEY=your-twitter-api-key
OAUTH_TWITTER_SECRET=your-twitter-api-secret
```

```yaml
oauth:
  providers:
    twitter:
      scope:
        - users.read
        - tweet.read
```

---

### 8. LinkedIn

**Developer Portal:** [linkedin.com/developers](https://www.linkedin.com/developers/apps)

1. Create an app → **Auth** → add redirect URL: `http://localhost:3000/connect/linkedin/callback`

```bash
OAUTH_LINKEDIN_KEY=your-linkedin-client-id
OAUTH_LINKEDIN_SECRET=your-linkedin-client-secret
```

```yaml
oauth:
  providers:
    linkedin:
      scope:
        - openid
        - email
        - profile
```

---

### 9. Spotify

**Developer Dashboard:** [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)

1. Create an app → **Edit Settings** → add redirect URI: `http://localhost:3000/connect/spotify/callback`

```bash
OAUTH_SPOTIFY_KEY=your-spotify-client-id
OAUTH_SPOTIFY_SECRET=your-spotify-client-secret
```

```yaml
oauth:
  providers:
    spotify:
      scope:
        - user-read-email
        - user-read-private
```

---

### 10. Slack

**API Portal:** [api.slack.com/apps](https://api.slack.com/apps)

1. Create an app → **OAuth & Permissions** → add redirect URL: `http://localhost:3000/connect/slack/callback`

```bash
OAUTH_SLACK_KEY=your-slack-client-id
OAUTH_SLACK_SECRET=your-slack-client-secret
```

```yaml
oauth:
  providers:
    slack:
      scope:
        - openid
        - email
        - profile
```

---

### 11. GitLab

**Application Settings:** [gitlab.com/-/profile/applications](https://gitlab.com/-/profile/applications)

1. Create a new application with redirect URI: `http://localhost:3000/connect/gitlab/callback`

```bash
OAUTH_GITLAB_KEY=your-gitlab-application-id
OAUTH_GITLAB_SECRET=your-gitlab-secret
```

```yaml
oauth:
  providers:
    gitlab:
      scope:
        - read_user
        - email
```

---

### 12. Bitbucket

**App Passwords:** [bitbucket.org/account/settings/app-passwords/](https://bitbucket.org/account/settings/)

1. Go to **Settings** → **OAuth consumers** → **Add consumer**
2. Set callback URL: `http://localhost:3000/connect/bitbucket/callback`

```bash
OAUTH_BITBUCKET_KEY=your-bitbucket-key
OAUTH_BITBUCKET_SECRET=your-bitbucket-secret
```

```yaml
oauth:
  providers:
    bitbucket:
      scope:
        - account
        - email
```

---

### 13. Twitch

**Developer Console:** [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)

1. Register a new application with redirect URL: `http://localhost:3000/connect/twitch/callback`

```bash
OAUTH_TWITCH_KEY=your-twitch-client-id
OAUTH_TWITCH_SECRET=your-twitch-client-secret
```

```yaml
oauth:
  providers:
    twitch:
      scope:
        - user:read:email
```

---

### 14. Dropbox

**App Console:** [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)

1. Create app → **Settings** → add redirect URI: `http://localhost:3000/connect/dropbox/callback`

```bash
OAUTH_DROPBOX_KEY=your-dropbox-app-key
OAUTH_DROPBOX_SECRET=your-dropbox-app-secret
```

```yaml
oauth:
  providers:
    dropbox:
      scope:
        - account_info.read
```

---

### 15. Shopify

**Partners Dashboard:** [partners.shopify.com](https://partners.shopify.com/)

1. Create an app → **App setup** → add redirect URL: `http://localhost:3000/connect/shopify/callback`

```bash
OAUTH_SHOPIFY_KEY=your-shopify-api-key
OAUTH_SHOPIFY_SECRET=your-shopify-api-secret
```

```yaml
oauth:
  providers:
    shopify:
      subdomain: your-store     # Your Shopify store subdomain
      scope:
        - read_products
        - read_customers
```

---

### 16. Notion

**Integrations:** [notion.so/my-integrations](https://www.notion.so/my-integrations)

1. Create a new integration → **OAuth** → set redirect URI: `http://localhost:3000/connect/notion/callback`

```bash
OAUTH_NOTION_KEY=your-notion-client-id
OAUTH_NOTION_SECRET=your-notion-client-secret
```

```yaml
oauth:
  providers:
    notion:
      scope: []
```

---

### 17. Zoom

**Marketplace:** [marketplace.zoom.us](https://marketplace.zoom.us/develop/create)

1. Create an OAuth app → add redirect URL: `http://localhost:3000/connect/zoom/callback`

```bash
OAUTH_ZOOM_KEY=your-zoom-client-id
OAUTH_ZOOM_SECRET=your-zoom-client-secret
```

```yaml
oauth:
  providers:
    zoom:
      scope:
        - user:read
```

---

### 18. Stripe

**Dashboard:** [dashboard.stripe.com](https://dashboard.stripe.com/settings/connect)

1. Go to **Settings** → **Connect** → set redirect URI: `http://localhost:3000/connect/stripe/callback`

```bash
OAUTH_STRIPE_KEY=your-stripe-client-id
OAUTH_STRIPE_SECRET=your-stripe-api-secret-key
```

```yaml
oauth:
  providers:
    stripe:
      scope:
        - read_write
```

---

### 19. Reddit

**App Preferences:** [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)

1. Create a new app (select **web app**) → set redirect URI: `http://localhost:3000/connect/reddit/callback`

```bash
OAUTH_REDDIT_KEY=your-reddit-client-id
OAUTH_REDDIT_SECRET=your-reddit-client-secret
```

```yaml
oauth:
  providers:
    reddit:
      scope:
        - identity
```

---

### 20. Auth0

**Dashboard:** [manage.auth0.com](https://manage.auth0.com/)

1. Create a new application → **Settings** → set callback URL: `http://localhost:3000/connect/auth0/callback`

```bash
OAUTH_AUTH0_KEY=your-auth0-client-id
OAUTH_AUTH0_SECRET=your-auth0-client-secret
```

```yaml
oauth:
  providers:
    auth0:
      subdomain: your-tenant    # Your Auth0 tenant subdomain
      scope:
        - openid
        - email
        - profile
```

---

## All Supported Providers (200+)

ChadStart uses the [grant](https://www.npmjs.com/package/grant) library under the hood, which supports **200+ OAuth providers**. Any provider listed at [github.com/simov/grant](https://github.com/simov/grant) can be added to your YAML config by its name.

Below is a selection of additional providers you can configure. The setup pattern is the same for all:

1. Set `OAUTH_<PROVIDER>_KEY` and `OAUTH_<PROVIDER>_SECRET` in your `.env`
2. Add the provider to your YAML config under `oauth.providers`
3. Add `<a href="/connect/<provider>">Login with Provider</a>` to your frontend

### Categories of Additional Providers

#### Developer & DevOps Platforms
`atlassian`, `azure`, `digitalocean`, `heroku`, `figma`, `vercel`

#### Social & Communication
`instagram`, `snapchat`, `tiktok`, `telegram`, `line`, `kakao`, `vk`, `weibo`, `wechat`, `yandex`

#### Enterprise & Productivity
`salesforce`, `hubspot`, `asana`, `basecamp`, `box`, `docusign`, `freshbooks`, `intuit`, `quickbooks`, `zendesk`

#### Gaming
`battlenet`, `epicgames`, `steam`, `riotgames`

#### Music & Media
`deezer`, `soundcloud`, `vimeo`, `dailymotion`

#### Finance & Payments
`paypal`, `square`, `coinbase`

#### Identity Providers
`okta`, `onelogin`, `keycloak`

#### Email & Marketing
`mailchimp`, `constantcontact`, `mailgun`

### Example: Adding any provider

The configuration pattern is identical for all providers:

```yaml
oauth:
  providers:
    <provider-name>:
      scope:
        - required-scope-1
        - required-scope-2
```

```bash
OAUTH_<PROVIDER_NAME>_KEY=your-client-id
OAUTH_<PROVIDER_NAME>_SECRET=your-client-secret
```

```html
<a href="/connect/<provider-name>">Login with Provider</a>
```

!!! tip
    Check the provider's documentation for the list of available scopes. Grant handles the OAuth protocol differences (OAuth 1.0, 1.0a, 2.0, and OpenID Connect) automatically.

## How It Works

### OAuth Flow

```
┌──────────┐     1. Click login      ┌────────────┐
│  Browser  │ ──────────────────────▶ │  ChadStart │
│           │                        │   /connect/ │
│           │  2. Redirect to        │   google    │
│           │ ◀────────────────────── │             │
│           │                        └────────────┘
│           │  3. Login at Google
│           │ ──────────────────────▶ ┌────────────┐
│           │                        │   Google    │
│           │  4. Redirect back      │   OAuth     │
│           │ ◀────────────────────── │   Server   │
│           │                        └────────────┘
│           │  5. Exchange code
│           │ ──────────────────────▶ ┌────────────┐
│           │                        │  ChadStart │
│           │  6. JWT token          │  /callback  │
│           │ ◀────────────────────── │             │
└──────────┘                        └────────────┘
```

1. User clicks a **"Login with Google"** button that links to `/connect/google`.
2. ChadStart (via Grant) redirects the user to Google's authorization page.
3. User authenticates with Google and grants permissions.
4. Google redirects back to ChadStart's callback URL with an authorization code.
5. Grant exchanges the code for tokens and fetches the user profile.
6. ChadStart finds or creates the user and returns a **JWT token**.

### User Creation

When a user logs in via OAuth for the first time:

- ChadStart looks for an existing user **by email address**.
- If found, the existing user is authenticated (no duplicate accounts).
- If not found, a **new user is created** with:
    - `email` from the OAuth profile
    - A random secure password (user authenticates via OAuth, not password)
    - `name` from the profile (if the entity has a `name` property)

### Token Usage

The JWT token returned from OAuth login works exactly the same as tokens from email/password login:

```http
GET /api/dynamic/posts
Authorization: Bearer <token-from-oauth>
```

## Frontend Integration

### HTML Buttons

```html
<!-- Simple login buttons -->
<a href="/connect/google" class="btn">Login with Google</a>
<a href="/connect/github" class="btn">Login with GitHub</a>
<a href="/connect/discord" class="btn">Login with Discord</a>
```

### React Example

```jsx
function OAuthButtons() {
  return (
    <div>
      <a href="/connect/google">Login with Google</a>
      <a href="/connect/github">Login with GitHub</a>
    </div>
  );
}

// Handle the redirect (on your successRedirect page)
function Dashboard() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      localStorage.setItem('token', token);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  return <div>Welcome!</div>;
}
```

### Vue Example

```vue
<template>
  <div>
    <a href="/connect/google">Login with Google</a>
    <a href="/connect/github">Login with GitHub</a>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  if (token) {
    localStorage.setItem('token', token)
    window.history.replaceState({}, '', window.location.pathname)
  }
})
</script>
```

### Dynamic Provider Buttons

```javascript
// Fetch available providers and render buttons dynamically
async function renderOAuthButtons(containerId) {
  const res = await fetch('/api/auth/oauth/providers');
  const { providers } = await res.json();

  const container = document.getElementById(containerId);
  providers.forEach(provider => {
    const link = document.createElement('a');
    link.href = `/connect/${provider}`;
    link.textContent = `Login with ${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
    link.className = 'oauth-btn';
    container.appendChild(link);
  });
}
```

## Multiple Providers

You can configure as many providers as you need:

```yaml
oauth:
  entity: User
  successRedirect: /dashboard
  providers:
    google:
      scope: [openid, email, profile]
    github:
      scope: [user:email]
    discord:
      scope: [identify, email]
    microsoft:
      scope: [openid, email, profile]
    spotify:
      scope: [user-read-email]
```

All providers share the same callback endpoint and user entity — a user who has signed in with Google and later tries GitHub (with the same email) will be matched to their existing account.

## Security Considerations

!!! warning "Important"
    - **Never** put OAuth client secrets in your YAML file — always use environment variables.
    - **Always** use HTTPS in production. OAuth tokens transmitted over HTTP can be intercepted.
    - Set `BASE_URL` in your `.env` to your production URL so redirect URIs are correct.
    - Some providers (like Apple) require HTTPS even for development.

### PKCE Support

For enhanced security, enable [PKCE](https://oauth.net/2/pkce/) on providers that support it:

```yaml
oauth:
  providers:
    google:
      pkce: true
      scope: [openid, email, profile]
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "redirect_uri_mismatch" | Make sure the redirect URI in your provider's console exactly matches `http(s)://your-domain/connect/<provider>/callback` |
| "invalid_client" | Double-check your `OAUTH_<PROVIDER>_KEY` and `OAUTH_<PROVIDER>_SECRET` environment variables |
| User not created | Ensure you have at least one entity with `authenticable: true` |
| Token not received | Check that `successRedirect` points to a valid page in your app |
| Provider not found | The provider name must be lowercase and match grant's naming (e.g., `github`, not `GitHub`) |

### Debug Tips

1. Check available providers: `GET /api/auth/oauth/providers`
2. Verify environment variables are set correctly
3. Check server logs for OAuth callback errors
4. Make sure `BASE_URL` is set in production
