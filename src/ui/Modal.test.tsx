import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import Modal from '@/ui/Modal';

function openModal(overrides: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  renderWithProviders(
    <Modal open onClose={onClose} title="Edit tags" {...overrides}>
      <p>Tag form</p>
    </Modal>,
  );
  return onClose;
}

describe('Modal', () => {
  it('stays out of the document while closed', () => {
    openModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Tag form')).toBeNull();
  });

  it('is a modal dialog named after its title', () => {
    openModal();
    const dialog = screen.getByRole('dialog', { name: 'Edit tags' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Tag form');
  });

  it('keeps the names apart when two dialogs are open', () => {
    renderWithProviders(
      <>
        <Modal open onClose={vi.fn()} title="Rename playlist"><p>a</p></Modal>
        <Modal open onClose={vi.fn()} title="Delete playlist"><p>b</p></Modal>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'Rename playlist' })).toHaveTextContent('a');
    expect(screen.getByRole('dialog', { name: 'Delete playlist' })).toHaveTextContent('b');
  });

  it('closes on Escape, on the backdrop and on the close button', async () => {
    const onClose = openModal({ closeLabel: 'Dismiss' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await userEvent.click(screen.getByRole('dialog').parentElement!);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('ignores clicks inside the card', async () => {
    const onClose = openModal();
    await userEvent.click(screen.getByText('Tag form'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can drop the close button', () => {
    openModal({ hideClose: true });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the optional subtitle and footer', () => {
    openModal({ subtitle: '3 tracks', footer: <button type="button">Apply</button> });
    expect(screen.getByText('3 tracks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });
});
