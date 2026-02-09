const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const MAX_TEXT_LEN = 3900;

function safeText(value, fallback = null) {
    const raw = value == null ? "" : String(value);
    const trimmed = raw.trim();
    const selected = trimmed.length
        ? trimmed
        : (fallback == null ? "" : String(fallback).trim());

    if (!selected.length) return null;
    return selected.length > MAX_TEXT_LEN
        ? `${selected.slice(0, MAX_TEXT_LEN - 3)}...`
        : selected;
}

/**
 * @typedef {Object} SectionData
 * @property {string} [title]
 * @property {string} [content]
 */

/**
 * @param {{
 *  title?: string,
 *  description?: string,
 *  sections?: SectionData[],
 *  media?: string | { url: string },
 *  footer?: string
 * }} input
 */
function createContainer(input) {
    const {
        title = "Hima",
        description,
        sections = [],
        media,
        footer
    } = input;

    const children = [];

    const titleText = safeText(`## ${title}`, "## Hima");
    if (titleText) children.push({ type: 10, content: titleText });

    children.push({ type: 14, divider: true, spacing: 1 });

    const descText = safeText(description, null);
    if (descText) children.push({ type: 10, content: descText });

    for (const section of sections) {
        const header = section.title ? `**${safeText(section.title, "-")}**\n` : "";
        const body = safeText(section.content, "-");
        const block = safeText(`${header}${body || ""}`, null);
        if (block) children.push({ type: 10, content: block });
    }

    if (media) {
        const url = typeof media === "string" ? media : media.url;
        children.push({
            type: 12,
            items: [{ media: { url } }]
        });
    }

    const footerText = safeText(footer ? `-# ${footer}` : null, null);
    if (footerText) {
        children.push({ type: 14, divider: true, spacing: 1 });
        children.push({ type: 10, content: footerText });
    }

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: children
            }
        ]
    };
}

/**
 * Reusable helper requested by spec.
 * @param {{
 *  title?: string,
 *  description?: string,
 *  fields?: Array<{name: string, value: string}>,
 *  image?: string,
 *  footer?: string
 * }} input
 */
function buildContainerMessage(input) {
    const sections = (input.fields || []).map((f) => ({
        title: safeText(f.name, "-") || "-",
        content: safeText(f.value, "-") || "-"
    }));

    return createContainer({
        title: safeText(input.title || "Hima", "Hima") || "Hima",
        description: input.description,
        sections,
        media: input.image,
        footer: input.footer
    });
}

module.exports = {
    COMPONENTS_V2_FLAG,
    createContainer,
    buildContainerMessage
};
