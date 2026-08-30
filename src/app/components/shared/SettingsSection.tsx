interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

export default function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <div className="cc-settings-section cc-pane-section">
      <div className="cc-settings-section__title cc-section-header">{title}</div>
      {children}
    </div>
  );
}
