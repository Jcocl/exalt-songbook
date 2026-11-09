# Visual assets and design references

## Current design

The revised interface follows the user's supplied CCF artwork: warm paper texture, bold condensed typography, restrained orange accents, and rich astronomy imagery. Songs, Lineups, and Saved are the primary navigation. Decorative explanatory copy and the former dashboard sidebar were removed.

### Supplied CCF image

| Property | Value |
| --- | --- |
| File | `public/ccf-music.webp` |
| Dimensions | 180 × 180 pixels |
| Source | User-supplied image #2, `726988860_1479529010880188_1998859928031672869_n.jpg` |
| Use | Header CCF badge and sign-in identity |

The supplied image contains the authentic CCF mark over printed music. It was resized and encoded as WebP only. Its logo, colors, background, lettering, and composition were not recreated or semantically modified. It is not an AI-generated CCF logo.

### Generated cosmic-paper artwork

| Property | Value |
| --- | --- |
| File | `public/cosmic-paper.webp` |
| Dimensions | 1800 × 600 pixels |
| Origin | Generated with the built-in imagegen tool for this redesign |
| Use | Compact songbook masthead and sign-in background |

This original artwork uses the supplied images as visual references for paper texture and astronomy colors. It has no lettering or logo. All interface text, controls, navigation, lyrics, and chords remain real interactive components.

#### Exact generation prompt

```text
Use case: ads-marketing. Asset type: custom panoramic background artwork for a church worship songbook app, not a screenshot or UI mockup. The supplied images are visual references only: take the cream grainy paper, forceful editorial restraint, and rich teal/purple/copper nebula palette. Create an original quiet cinematic cosmic-paper composition: left 60 percent warm ivory tactile uncoated paper with extremely subtle realistic fibers, nearly blank and bright for dark readable interface lettering; right 40 percent dark deep-teal and muted purple nebula with small natural stars and a restrained burnt-orange cloud, layered like an archival printed astronomy photograph. Beautiful fine photographic grain, sophisticated physical print texture, calm asymmetry; a natural torn-paper edge joins the paper and astronomy image near the right third. Landscape 3:1 crop, usable as a compact horizontal strip. No letters, no words, no numbers, no logos, no CCF mark, no crosses, no people, no instruments, no mock interface, no glowing decorative shapes, no rounded cards, no artificial gradient background. Preserve generous genuinely empty cream space on the left. This artwork complements the user's real supplied church branding and does not recreate its logo.
```

The artwork is optimized as WebP and cropped with CSS for different screen sizes. Text and functional controls have their own solid-color styling and do not depend on image contents.

### Generated lineup masthead & empty-state artwork

| File | Dimensions | Use |
| --- | --- | --- |
| `public/lineup-masthead.webp` | 1800 × 600 pixels | Service Lineups masthead banner (`#lineups`) |
| `public/empty-state-art.webp` | 480 × 480 pixels | Illustrated empty-state card (`Empty` component) |

Both assets follow the same editorial paper-and-cosmos visual direction (`#f2eee5` / `#faf7f0` uncoated paper, `#205c5a` deep teal, and `#bf4524` burnt copper) with zero embedded text or logos.

## Supplied visual references

The user's four images informed this revision:

1. `762291772_1517795410386881_6570924491123856042_n.jpg`: warm textured paper, bold editorial lettering, and the CCF anniversary composition.
2. `726988860_1479529010880188_1998859928031672869_n.jpg`: authentic CCF mark over printed music, used directly as described above.
3. `762676779_1517794653720290_137449331372401659_n.jpg`: deep teal, purple, and copper astronomy palette.
4. `874109766_1605253791641042_9047653160414937955_n.jpg`: tactile print texture and rich restrained colors.

The anniversary number and event dates are not used as application branding. The **EXALT SONGBOOK** text names the application; no Exalt ministry logo was generated or reconstructed.

Original reference links supplied in the brief:

- [Christ's Commission Fellowship](https://www.ccf.org.ph/)
- [Exalt Worship](https://ccfexaltworship.com/)
- [CCF Tarlac Facebook page](https://www.facebook.com/CCF.TARLACPH)

The Facebook page was unavailable during the original inspection. The subsequently supplied image files provide the direct visual evidence used for this redesign. The interface is not represented as an official ministry-approved brand standard.

## Retained earlier asset

`public/rehearsal.webp` is the earlier generated conceptual photograph of rehearsal equipment. It is retained in the repository but is no longer the active banner or sign-in background. It is not a photograph of CCF Tarlac or a real ministry event.

## Other resources

- Interface fonts: DM Sans and Barlow Condensed, with system fallbacks.
- Functional icons: `lucide-react`.
- `public/reference-lineup.pdf`: the original user-supplied lineup for checking imported song sheets. Its song content and attribution come from that document, not from image generation.
