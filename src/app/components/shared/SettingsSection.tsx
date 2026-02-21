interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

export default function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <div className="cc-settings-section">
      <div className="cc-settings-section__title">{title}</div>
      {children}
    </div>
  );
}
