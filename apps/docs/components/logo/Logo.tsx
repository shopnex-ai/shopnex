import Link from 'next/link';

import { LogoIcon } from './LogoIcon';

export const Logo = () => {
    return (
        <Link
            href={process.env.NEXT_PUBLIC_SERVER_URL || '/'}
            rel='noreferrer noopener'
            style={{
                alignItems: 'center',
                display: 'flex',
                fontSize: '32px',
                fontWeight: 'bold',
                textDecoration: 'none',
            }}>
            <LogoIcon size={56} />
            <span
                style={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '6px',
                    position: 'relative',
                }}>
                ShopNex
            </span>
        </Link>
    );
};
