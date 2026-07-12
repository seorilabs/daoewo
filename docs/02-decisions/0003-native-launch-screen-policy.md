# ADR 0003: Native Launch Screen Policy

## Status

Accepted

## Context

Bare React Native iOS projects can briefly show the default `LaunchScreen.storyboard` before JavaScript renders. Android also has native startup surfaces before the React Native UI is ready. These surfaces are visible during cold start and App Store / Google Play review, so template or framework branding reads as unfinished product quality.

The launch screen is owned by the native platform, not the React Native component tree. Removing it usually creates a blank or jarring startup instead of a better experience.

## Decision

- Treat native launch/splash screens as release assets.
- Replace framework defaults immediately after native project bootstrap.
- Use product branding as the primary startup signal: app icon/logo, app name when appropriate, and a background color that matches the first rendered screen.
- Keep Seorilabs attribution optional and secondary. Prefer small `Seorilabs` text near the bottom only when it does not make startup feel like a corporate interstitial.
- Do not show framework/vendor text such as `Powered by React Native`, `Welcome to React Native`, or technical target names.
- iOS keeps `UILaunchStoryboardName` and replaces the storyboard/assets. Do not delete the launch storyboard just to hide the default template.
- Android configures app-branded launch theme/splash assets for platform startup.
- If native startup disappears before initial React Native state is ready, hold the same branded screen with `react-native-bootsplash` or an equivalent native bridge and hide it after the first app state is ready.

## Consequences

- Store-review builds must verify cold-start visuals on device or simulator.
- `apps/mobile` bootstrap output needs a post-bootstrap native splash cleanup step.
- Release readiness checks should block known framework template strings in native startup files.
