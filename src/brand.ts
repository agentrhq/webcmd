export const PRODUCT_NAME = 'webcmd';
export const PRODUCT_DISPLAY_NAME = 'Webcmd';
export const CLI_COMMAND = 'webcmd';
export const PACKAGE_NAME = '@agentrhq/webcmd';
export const CONFIG_DIR_NAME = '.webcmd';
export const ENV_PREFIX = 'WEBCMD';
export const DAEMON_HEADER_NAME = 'X-Webcmd';
export const EXTENSION_PACKAGE_NAME = 'webcmd-extension';
export const EXTENSION_ARTIFACT_PREFIX = 'webcmd-extension';

/**
 * Brand accent. Single source of truth shared by the help banner and the
 * mascot; matches `colors.light` in docs/docs.json and the stroke color in
 * docs/webcmd*.svg.
 */
export const ACCENT_RGB = { r: 0x56, g: 0xc5, b: 0xff } as const;

/** Deeper brand blue, matching `colors.primary`/`colors.dark` in docs/docs.json. */
export const SHADE_RGB = { r: 0x00, g: 0x6b, b: 0x9a } as const;
