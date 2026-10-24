# GitHub Pages deployment

1. Create a repository and upload the contents of the project directory to the repository root. Do not upload the ZIP as the site source.
2. In **Settings → Pages**, select **Deploy from a branch**, choose `main` (or your release branch) and `/(root)`.
3. Wait until Pages reports a successful deployment and open the HTTPS site.
4. Check **Settings → Notifications**. Tap the ChronoPulse Notifications switch, continue through the app explanation, and allow the browser permission prompt. The switch should turn orange and read `On`; the test-notification button should become enabled.
5. If the browser permission was previously denied, use the browser's site settings to allow notifications, then reload ChronoPulse.
6. Test the deployed app after a reload and after an offline launch. The service worker cache version should be `chronopulse-v4.2-4.2.8`.

Notifications need HTTPS (or localhost). Browser permission can be granted while OS-level notification settings, Focus/Do Not Disturb, or power saving still suppress delivery.
