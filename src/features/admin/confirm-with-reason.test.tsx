import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ConfirmWithReason } from './confirm-with-reason';

function setup(props: Partial<React.ComponentProps<typeof ConfirmWithReason>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  renderWithIntl(
    <ConfirmWithReason
      open
      onOpenChange={onOpenChange}
      title="Pubblicare questa versione?"
      targetId="cfg_0002"
      confirmLabel="Pubblica"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe('ConfirmWithReason', () => {
  it('shows the target and refuses to confirm without a long enough reason', () => {
    const { onConfirm } = setup();
    expect(screen.getByRole('dialog', { name: 'Pubblicare questa versione?' })).toBeInTheDocument();
    expect(screen.getByText('cfg_0002')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Scrivi un motivo di almeno 5 caratteri.');
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: '  ok  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: '  Approvato dal design  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('Approvato dal design');
  });

  it('with a typed confirmation the exact text is required too', () => {
    const { onConfirm } = setup({ typedConfirmation: 'mock-2' });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Approvato dal design' } });
    fireEvent.change(screen.getByLabelText('Per confermare scrivi «mock-2»'), {
      target: { value: 'mock-3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    expect(screen.getByText('Il testo non corrisponde.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Per confermare scrivi «mock-2»'), {
      target: { value: 'mock-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pubblica' }));
    expect(onConfirm).toHaveBeenCalledWith('Approvato dal design');
  });

  it('cancel closes without confirming and nothing can be submitted while pending', () => {
    const { onConfirm, onOpenChange } = setup({ pending: true });
    expect(screen.getByRole('button', { name: 'Pubblica' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
