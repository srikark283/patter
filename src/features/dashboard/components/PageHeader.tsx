import { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: Props) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight leading-none">{title}</h2>
        {description && <p className="mt-1.5 text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
