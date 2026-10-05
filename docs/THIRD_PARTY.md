# Distribution boundary

The delivered standalone HTML contains only this project's authored HTML, CSS and JavaScript. Runtime dependency count is zero. The source ZIP contains authored source/tests/docs and synthetic SRT/JSON expectations.

Development-only dependency:
- `@playwright/test` 1.56.0 and its Playwright packages: Apache-2.0. Installed through the pinned npm lockfile, not copied into the app or source archive. [Official repository](https://github.com/microsoft/playwright)

Test-only host tools:
- Chromium installed by Playwright or selected using CHROME_BIN
- FFmpeg/FFprobe from the host's official distribution
- Poppler tools for rendering/reading the browser-produced PDF
- Noto CJK system fonts installed on the CI runner for Japanese screenshot/print verification

No vendor binaries, SDKs, fonts, footage, browser traces, third-party captions, or dependency directories are distributed. The native-track test generates a temporary monochrome video with FFmpeg's lavfi source and deletes it. Browser evidence can contain own screenshots and PDFs with text rendered by host system fonts; font binaries are never included in the standalone app/source ZIP.

No additional service, new account, paid tier, persistent permission, or secret is required.
