import type { ComponentPropsWithoutRef, ElementType } from 'react';

type PrimitiveProps<T extends ElementType> = {
  as?: T;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>;

function classes(baseClass: string, className?: string): string {
  return className ? `${baseClass} ${className}` : baseClass;
}

export function Pane<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: PrimitiveProps<T>) {
  const Component = as ?? 'div';
  return <Component className={classes('cc-pane', className)} {...props} />;
}

export function PaneSection<T extends ElementType = 'section'>({
  as,
  className,
  ...props
}: PrimitiveProps<T>) {
  const Component = as ?? 'section';
  return <Component className={classes('cc-pane-section', className)} {...props} />;
}

export function SectionHeader<T extends ElementType = 'header'>({
  as,
  className,
  ...props
}: PrimitiveProps<T>) {
  const Component = as ?? 'header';
  return <Component className={classes('cc-section-header', className)} {...props} />;
}

export function ListRow<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: PrimitiveProps<T>) {
  const Component = as ?? 'div';
  return <Component className={classes('cc-list-row', className)} {...props} />;
}

export function PropertyRow<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: PrimitiveProps<T>) {
  const Component = as ?? 'div';
  return <Component className={classes('cc-property-row', className)} {...props} />;
}

export function InsertionTarget<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: PrimitiveProps<T>) {
  const Component = as ?? 'div';
  return <Component className={classes('cc-insertion-target', className)} {...props} />;
}

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

type StatusDotProps<T extends ElementType> = PrimitiveProps<T> & {
  tone?: StatusTone;
};

export function StatusDot<T extends ElementType = 'span'>({
  as,
  className,
  tone = 'neutral',
  ...props
}: StatusDotProps<T>) {
  const Component = as ?? 'span';
  return (
    <Component
      className={classes('cc-status-dot', className)}
      data-tone={tone}
      aria-hidden="true"
      {...props}
    />
  );
}
