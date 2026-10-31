// PostHog for hosted deployments of Shopnex (app.shopnex.ai, the public demo). It exists only when the operator sets
// POSTHOG_KEY at runtime: a clone, a fork or a self-hosted install has no key anywhere, so nothing loads and nothing
// is sent. The key is never in the source or the image: it is read from the server's environment and handed to the
// browser by the root loader.
//
// The admin shows customer names, emails and orders, so this is deliberately narrow: pageviews only, no autocapture
// (it records element text), no session replay, no person profiles.

export interface AnalyticsConfig {
  key: string
  host: string
}

// The official PostHog loader stub: queues calls until the library arrives from the CDN.
const LOADER = "!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(\".\");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement(\"script\")).type=\"text/javascript\",p.crossOrigin=\"anonymous\",p.async=!0,p.src=s.api_host.replace(\".i.posthog.com\",\"-assets.i.posthog.com\")+\"/static/array.js\",(r=t.getElementsByTagName(\"script\")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=\"posthog\",u.people=u.people||[],u.toString=function(t){var e=\"posthog\";return\"posthog\"!==a&&(e+=\".\"+a),t||(e+=\" (stub)\"),e},u.people.toString=function(){return u.toString(1)+\".people (stub)\"},o=\"init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug\".split(\" \"),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);"

export function analyticsScript({ key, host }: AnalyticsConfig) {
  return `${LOADER}
posthog.init(${JSON.stringify(key)}, {
  api_host: ${JSON.stringify(host)},
  defaults: 'latest',
  person_profiles: 'identified_only',
  persistence: 'localStorage',
  respect_dnt: true,
  autocapture: false,
  disable_session_recording: true,
  capture_pageview: 'history_change',
});
posthog.register({ site: 'app' });`
}
