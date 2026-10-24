# Companion Actions (`src/actions`)

- `commandRouter.js` exports `routeCommand(transcript, options)` to return a structured request for an allowlisted website, image description, text reading, or an unknown command.
- `openAllowedSite(siteId)` navigates only to the fixed YouTube and Google URLs in the current tab.

Image description requests are not executed by the router. OCR is reported as unavailable until an OCR module is implemented and connected.
