import { AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { registerSiteAuthCommands } from '@agentrhq/webcmd/plugin-runtime';
import {
    MERIDIAN_API_ORIGIN, MERIDIAN_APP_ORIGIN, MERIDIAN_DOMAIN,
    ensureOnMeridianApp, hasMeridianSessionCookie, normalizeText,
} from './utils.js';

async function verifyMeridianIdentity(page) {
    await ensureOnMeridianApp(page);
    if (!await hasMeridianSessionCookie(page)) {
        throw new AuthRequiredError(
            MERIDIAN_DOMAIN,
            'Meridian session_token cookie missing — sign in (or sign up) at app.getmeridian.tech first.',
        );
    }
    const result = await page.evaluate(`(async () => {
      try {
        var res = await fetch(${JSON.stringify(`${MERIDIAN_API_ORIGIN}/api/auth/me`)}, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        if (res.status === 401 || res.status === 403) {
          return { kind: 'auth', detail: 'Meridian /auth/me returned HTTP ' + res.status + ' — session expired or not signed in' };
        }
        if (!res.ok) return { kind: 'http', httpStatus: res.status };
        var me = await res.json();
        if (!me || !me.email) {
          return { kind: 'auth', detail: 'Meridian /auth/me returned no identity — anonymous session' };
        }
        return { ok: true, identity: me };
      } catch (e) {
        return { kind: 'exception', detail: String((e && e.message) || e) };
      }
    })()`);
    if (result?.kind === 'auth') throw new AuthRequiredError(MERIDIAN_DOMAIN, result.detail);
    if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from Meridian /auth/me`);
    if (result?.kind === 'exception') throw new CommandExecutionError(`Meridian whoami failed: ${result.detail}`);
    if (!result?.ok) throw new CommandExecutionError(`Unexpected Meridian identity probe: ${JSON.stringify(result)}`);
    const me = result.identity;
    return {
        email: normalizeText(me.email),
        name: normalizeText(me.name) || null,
        org: normalizeText(me.org_name) || null,
        credits: Number.isFinite(Number(me.credits_balance)) ? Number(me.credits_balance) : null,
    };
}

registerSiteAuthCommands({
    site: 'meridian',
    domain: MERIDIAN_DOMAIN,
    // Sign-in is a modal on the app landing page (there is no /login route);
    // signed-in profiles are redirected straight into /app/initiatives.
    loginUrl: `${MERIDIAN_APP_ORIGIN}/`,
    loginDescription: 'Open Meridian so you can sign in or sign up (email/password or Google) and authorize this browser profile',
    columns: ['email', 'name', 'org', 'credits'],
    quickCheck: hasMeridianSessionCookie,
    verify: verifyMeridianIdentity,
});
