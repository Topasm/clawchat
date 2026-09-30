import { useMemo, useState } from 'react';
import { useProjectsQuery, useSkillsQuery, type ScheduledJobInput } from '../../hooks/queries';
import { translateUi } from '../../i18n';
import {
  DEFAULT_SCHEDULE,
  WEEKDAYS,
  localTimeZone,
  rruleToSchedule,
  scheduleToRrule,
  type JobFrequency,
  type JobScheduleDraft,
  type Weekday,
} from '../../services/jobSchedule';
import type { ScheduledJob } from '../../types/schemas';
import { weekdayLabel } from './scheduleText';

interface Template {
  label: string;
  title: string;
  instruction: string;
  skill: string;
  schedule: JobScheduleDraft;
}

const TEMPLATES: Template[] = [
  {
    label: 'Weekly status update',
    title: 'Weekly status update',
    instruction:
      'Draft a short status update: what got done since the last update, what is in progress, what is blocked and on what, and what is at risk of slipping.',
    skill: 'draft',
    schedule: { ...DEFAULT_SCHEDULE, frequency: 'weekly', days: ['MO'], time: '09:00' },
  },
  {
    label: 'Evening blocker check',
    title: 'What is blocked',
    instruction:
      'List every blocked task with what it is waiting on, and suggest the single next action that would unblock the most work.',
    skill: 'summarize',
    schedule: { ...DEFAULT_SCHEDULE, frequency: 'weekdays', time: '18:00' },
  },
  {
    label: 'Monday priorities',
    title: 'This week’s priorities',
    instruction:
      'Pick the three tasks that matter most this week, considering deadlines, blocked work, and what is ready to start. Explain each choice in one line.',
    skill: 'prioritize',
    schedule: { ...DEFAULT_SCHEDULE, frequency: 'weekly', days: ['MO'], time: '08:30' },
  },
];

const FREQUENCIES: { value: JobFrequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

interface ScheduledJobEditorProps {
  job?: ScheduledJob;
  saving: boolean;
  onSave: (input: ScheduledJobInput) => void;
  onCancel: () => void;
}

export default function ScheduledJobEditor({
  job,
  saving,
  onSave,
  onCancel,
}: ScheduledJobEditorProps) {
  const { data: skillsData } = useSkillsQuery();
  const { data: projects = [] } = useProjectsQuery();
  const skills = useMemo(() => skillsData?.skills ?? [], [skillsData]);
  const [title, setTitle] = useState(job?.title ?? '');
  const [instruction, setInstruction] = useState(job?.instruction ?? '');
  const [skill, setSkill] = useState(job?.skill_chain[0] ?? 'draft');
  const [projectId, setProjectId] = useState<string | null>(job?.project_id ?? null);
  const [includeSnapshot, setIncludeSnapshot] = useState(job?.include_task_snapshot ?? true);
  // A rule this editor did not make stays as it is unless the user replaces it.
  const parsed = job ? rruleToSchedule(job.rrule) : DEFAULT_SCHEDULE;
  const [schedule, setSchedule] = useState<JobScheduleDraft>(parsed ?? DEFAULT_SCHEDULE);
  const [keepCustomRule, setKeepCustomRule] = useState(Boolean(job && !parsed));
  const timezone = job?.timezone ?? localTimeZone();

  const updateSchedule = (changes: Partial<JobScheduleDraft>) => {
    setKeepCustomRule(false);
    setSchedule((current) => ({ ...current, ...changes }));
  };
  const toggleDay = (day: Weekday) =>
    updateSchedule({
      days: schedule.days.includes(day)
        ? schedule.days.filter((value) => value !== day)
        : [...schedule.days, day],
    });
  const applyTemplate = (template: Template) => {
    setTitle(translateUi(template.title));
    setInstruction(translateUi(template.instruction));
    setSkill(template.skill);
    updateSchedule(template.schedule);
  };
  const canSave = title.trim() !== '' && instruction.trim() !== '' && skill !== '' && !saving;

  return (
    <form
      className="cc-card cc-job-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        onSave({
          title: title.trim(),
          instruction: instruction.trim(),
          skill_chain: [skill],
          project_id: projectId,
          include_task_snapshot: includeSnapshot,
          rrule: keepCustomRule && job ? job.rrule : scheduleToRrule(schedule),
          timezone,
          enabled: job?.enabled ?? true,
        });
      }}
    >
      {!job && (
        <div
          className="cc-job-editor__templates"
          role="group"
          aria-label={translateUi('Start from a template')}
        >
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              className="cc-btn cc-btn--small"
              onClick={() => applyTemplate(template)}
            >
              {translateUi(template.label)}
            </button>
          ))}
        </div>
      )}

      <label className="cc-job-editor__field">
        <span>{translateUi('Name')}</span>
        <input
          className="cc-settings-input"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={translateUi('Weekly status update')}
        />
      </label>

      <label className="cc-job-editor__field">
        <span>{translateUi('What should the agent do?')}</span>
        <textarea
          className="cc-settings-input cc-job-editor__instruction"
          value={instruction}
          maxLength={8000}
          rows={4}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={translateUi('Draft a short status update from my tasks.')}
        />
      </label>

      <div className="cc-job-editor__row">
        <label className="cc-job-editor__field">
          <span>{translateUi('Skill')}</span>
          <select
            className="cc-settings-input"
            value={skill}
            onChange={(event) => setSkill(event.target.value)}
          >
            {skills.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-job-editor__field">
          <span>{translateUi('Tasks to look at')}</span>
          <select
            className="cc-settings-input"
            value={projectId ?? ''}
            onChange={(event) => setProjectId(event.target.value || null)}
          >
            <option value="">{translateUi('All tasks')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="cc-job-editor__schedule">
        <legend>{translateUi('When')}</legend>
        {keepCustomRule && job ? (
          <p className="cc-job-editor__hint">
            {translateUi('Custom schedule: {{rule}}', { rule: job.rrule })}{' '}
            <button
              type="button"
              className="cc-btn cc-btn--small"
              onClick={() => setKeepCustomRule(false)}
            >
              {translateUi('Replace')}
            </button>
          </p>
        ) : (
          <div className="cc-job-editor__row">
            <select
              className="cc-settings-input"
              aria-label={translateUi('Repeat')}
              value={schedule.frequency}
              onChange={(event) =>
                updateSchedule({ frequency: event.target.value as JobFrequency })
              }
            >
              {FREQUENCIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {translateUi(option.label)}
                </option>
              ))}
            </select>
            {schedule.frequency === 'monthly' && (
              <label className="cc-job-editor__inline">
                <span>{translateUi('Day')}</span>
                <input
                  className="cc-settings-input cc-job-editor__day-of-month"
                  type="number"
                  min={1}
                  max={28}
                  value={schedule.dayOfMonth}
                  onChange={(event) =>
                    updateSchedule({ dayOfMonth: Number(event.target.value) || 1 })
                  }
                />
              </label>
            )}
            <input
              className="cc-settings-input"
              type="time"
              aria-label={translateUi('Time')}
              value={schedule.time}
              onChange={(event) => updateSchedule({ time: event.target.value })}
            />
            <span className="cc-job-editor__hint">{timezone}</span>
          </div>
        )}
        {!keepCustomRule && schedule.frequency === 'weekly' && (
          <div className="cc-job-editor__days" role="group" aria-label={translateUi('Days')}>
            {WEEKDAYS.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={schedule.days.includes(day)}
                className={`cc-btn cc-btn--small${schedule.days.includes(day) ? ' cc-btn--primary' : ''}`}
                onClick={() => toggleDay(day)}
              >
                {weekdayLabel(day)}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <label className="cc-job-editor__check">
        <input
          type="checkbox"
          checked={includeSnapshot}
          onChange={(event) => setIncludeSnapshot(event.target.checked)}
        />
        <span>
          {translateUi(
            'Include a snapshot of the tasks: what is in progress, ready, blocked, overdue, and done since the last run',
          )}
        </span>
      </label>

      <div className="cc-job-editor__actions">
        <button type="button" className="cc-btn" onClick={onCancel}>
          {translateUi('Cancel')}
        </button>
        <button type="submit" className="cc-btn cc-btn--primary" disabled={!canSave}>
          {job ? translateUi('Save') : translateUi('Create job')}
        </button>
      </div>
    </form>
  );
}
