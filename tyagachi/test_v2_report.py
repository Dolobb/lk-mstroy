#!/usr/bin/env python3
"""
Test script for generating V2 report with 3-column layout.

This script generates a report_v2.html file using the new html_generator_v2.py
for A/B comparison with the original report.html.

Usage:
    python test_v2_report.py                              # Uses existing matched.csv
    python test_v2_report.py --fetch --from-pl 01.02.2026 --to-pl 05.02.2026  # Fetch new data
"""

import sys
import argparse
from pathlib import Path
import pandas as pd

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from src.output.html_generator_v2 import generate_html_report, build_hierarchy


def parse_args():
    parser = argparse.ArgumentParser(description='Generate V2 report for A/B testing')
    parser.add_argument('--data', type=str, default='output/matched.csv',
                        help='Path to matched.csv file')
    parser.add_argument('--output', type=str, default='output/report_v2.html',
                        help='Output path for V2 report')
    parser.add_argument('--fetch', action='store_true',
                        help='Fetch fresh data from API before generating')
    parser.add_argument('--from-pl', dest='from_pl', type=str,
                        help='Start date for PL (DD.MM.YYYY)')
    parser.add_argument('--to-pl', dest='to_pl', type=str,
                        help='End date for PL (DD.MM.YYYY)')
    return parser.parse_args()


def main():
    args = parse_args()

    # If --fetch is specified, run the main pipeline first
    if args.fetch:
        if not args.from_pl or not args.to_pl:
            print("Error: --fetch requires --from-pl and --to-pl dates")
            sys.exit(1)

        print(f"Fetching data for period {args.from_pl} - {args.to_pl}...")
        import subprocess
        result = subprocess.run([
            sys.executable, 'main.py',
            '--fetch',
            '--from-pl', args.from_pl,
            '--to-pl', args.to_pl
        ], capture_output=True, text=True)

        if result.returncode != 0:
            print(f"Error fetching data: {result.stderr}")
            sys.exit(1)

        print("Data fetched successfully")

    # Check if matched.csv exists
    data_path = Path(args.data)
    if not data_path.exists():
        print(f"Error: {data_path} not found")
        print("Run with --fetch flag or ensure matched.csv exists")
        sys.exit(1)

    print(f"Loading data from {data_path}...")

    # Load matched data
    df = pd.read_csv(data_path)

    # Convert DataFrame to list of dicts for hierarchy builder
    # Handle JSON columns
    import json
    import ast

    def parse_json_column(val):
        if pd.isna(val):
            return []
        if isinstance(val, str):
            try:
                return json.loads(val)
            except:
                try:
                    return ast.literal_eval(val)
                except:
                    return []
        return val

    # Parse JSON columns
    json_columns = ['mon_track', 'mon_parkings', 'mon_fuels']
    for col in json_columns:
        if col in df.columns:
            df[col] = df[col].apply(parse_json_column)

    matched_data = df.to_dict('records')

    print(f"Loaded {len(matched_data)} matched records")

    # Build hierarchy
    hierarchy = build_hierarchy(matched_data)

    print(f"Built hierarchy with {len(hierarchy)} requests")

    # Generate V2 report
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Generating V2 report to {output_path}...")

    result_path = generate_html_report(
        hierarchy,
        str(output_path),
        title="Аналитика заявок (V2 - 3-колоночный layout)"
    )

    print(f"✓ V2 report generated: {result_path}")
    print()
    print("To compare layouts, open both files in browser:")
    print(f"  - Original: output/report.html")
    print(f"  - V2:       {result_path}")


if __name__ == '__main__':
    main()
