import { PaneSection, SectionHeader } from './WorkspacePrimitives';

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

export default function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <PaneSection className="cc-settings-section">
      <SectionHeader as="div" className="cc-settings-section__title">
        {title}
      </SectionHeader>
      {children}
    </PaneSection>
  );
}
