import { NextResponse } from 'next/server';
import { getContextVersions } from '@/lib/clickhouse';

export async function GET() {
  try {
    const versions = await getContextVersions(100);
    return NextResponse.json(versions);
  } catch (error) {
    console.error('Failed to fetch context versions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch context versions' },
      { status: 500 }
    );
  }
}
