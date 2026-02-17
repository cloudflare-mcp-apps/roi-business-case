export const UI_MIME_TYPE = "text/html;profile=mcp-app" as const;

export const UI_RESOURCES = {
  widget: {
    uri: "ui://roi-business-case/widget.html",
    name: "business_case_widget",
    description: "Interactive ROI Business Case calculator with dynamic sliders, charts, and formatted output",
    mimeType: UI_MIME_TYPE,
    _meta: {
      ui: {
        csp: {
          connectDomains: [] as string[],
          resourceDomains: [] as string[],
        },
        prefersBorder: true,
      },
    },
  },
} as const;
