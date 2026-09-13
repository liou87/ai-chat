export const colors = {
  primary: "#0084ff",
  primaryText: "#ffffff",
  border: "#e2e2e2",
  borderLight: "#f0f0f0",
  textMuted: "#999999",
  textSecondary: "#666666",
  danger: "#d64545",
  warningBg: "#fff3cd",
  warningBorder: "#ffe69c",
  warningText: "#856404",
  surface: "#ffffff",
}

export const radiusSm = 6

export const inputStyle = {
  padding: "7px 10px",
  borderRadius: radiusSm,
  border: `1px solid ${colors.border}`,
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
}

export const buttonStyle = {
  padding: "7px 12px",
  borderRadius: radiusSm,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  cursor: "pointer",
  fontSize: 14,
}

export const primaryButtonStyle = {
  ...buttonStyle,
  background: colors.primary,
  color: colors.primaryText,
  border: "none",
}

export const iconButtonStyle = {
  border: "none",
  background: "none",
  cursor: "pointer",
  color: colors.danger,
  fontSize: 16,
  lineHeight: 1,
  padding: 2,
}
