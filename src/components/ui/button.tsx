import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors select-none disabled:opacity-45 disabled:pointer-events-none aria-disabled:opacity-45',
  {
    variants: {
      variant: {
        primary:
          'bg-brand text-white hover:bg-brand-hover active:bg-brand-active shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset]',
        secondary: 'bg-surface-3 text-fg hover:bg-surface-4 border border-border-strong',
        ghost: 'text-muted hover:text-fg hover:bg-surface-3',
        outline: 'border border-border-strong text-fg hover:bg-surface-3',
        danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
        link: 'text-skyline underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-5 text-base',
        xl: 'h-14 px-6 text-base w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  /** Accessible name — icon-only buttons must always have one. */
  label: string;
  children: React.ReactNode;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className, size = 'md', variant = 'ghost', children, ...props }, ref) => (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      variant={variant}
      className={cn('px-0', size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10', className)}
      {...props}
    >
      {children}
    </Button>
  ),
);
IconButton.displayName = 'IconButton';
