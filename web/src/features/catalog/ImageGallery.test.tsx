import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLang } from '../../shared/lib/i18n';
import { ImageGallery } from './ImageGallery';

const img = (id: string) => ({
  id,
  sm: `/${id}-sm.jpg`,
  md: `/${id}-md.jpg`,
  lg: `/${id}-lg.jpg`,
  width: 800,
  height: 600,
});
const PHOTOS = [img('a'), img('b'), img('c')];

describe('product photos: full screen viewer', () => {
  beforeEach(() => useLang.getState().setLang('en'));

  it('opens the photo full screen from the main image, and closes with Esc or the close button', async () => {
    render(<ImageGallery images={PHOTOS} name="Aula F75" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View photo full screen' }));
    expect(screen.getByRole('dialog', { name: 'Aula F75: photos' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View photo full screen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on the photo being shown, and moves between photos with the arrows and keys, round the ends', async () => {
    render(<ImageGallery images={PHOTOS} name="Aula F75" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show photo 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'View photo full screen' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('2/3');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(dialog).toHaveTextContent('1/3');
    await userEvent.keyboard('{ArrowLeft}');
    expect(dialog).toHaveTextContent('3/3');
    await userEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(dialog).toHaveTextContent('1/3');
  });

  it('zooms with the buttons and keys, and the zoom out and reset buttons only work while zoomed', async () => {
    render(<ImageGallery images={PHOTOS} name="Aula F75" />);
    await userEvent.click(screen.getByRole('button', { name: 'View photo full screen' }));
    const zoomed = () => screen.getAllByAltText(/photo 1/).at(-1)!.style.transform;
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomed()).toContain('scale(1.6)');
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeEnabled();
    await userEvent.keyboard('0');
    expect(zoomed()).toContain('scale(1)');
  });

  it('shows the thumbnails and goes to a photo when one is tapped', async () => {
    render(<ImageGallery images={PHOTOS} name="Aula F75" />);
    await userEvent.click(screen.getByRole('button', { name: 'View photo full screen' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(
      dialog.querySelectorAll<HTMLButtonElement>('button[aria-label="Show photo 3"]')[0]!,
    );
    expect(dialog).toHaveTextContent('3/3');
  });

  it('with one photo has no arrows or thumbnails, and with none shows a placeholder, not a button', () => {
    const { unmount } = render(<ImageGallery images={[img('a')]} name="Solo" />);
    expect(screen.queryByRole('button', { name: 'Show photo 1' })).not.toBeInTheDocument();
    unmount();
    render(<ImageGallery images={[]} name="Empty" />);
    expect(
      screen.queryByRole('button', { name: 'View photo full screen' }),
    ).not.toBeInTheDocument();
  });
});
