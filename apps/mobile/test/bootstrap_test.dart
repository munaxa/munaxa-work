// Proves the application builds and renders. Phase 19.1 brings the real test matrix:
// widget, permission, offline and sync, localization in both directions, and accessibility.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:munaxa_work/main.dart';

void main() {
  testWidgets('renders the bootstrap screen', (WidgetTester tester) async {
    await tester.pumpWidget(const MunaxaWorkApp());

    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.text('Munaxa Work'), findsOneWidget);
  });

  testWidgets('supports Arabic and English', (WidgetTester tester) async {
    await tester.pumpWidget(const MunaxaWorkApp());

    final MaterialApp app = tester.widget(find.byType(MaterialApp));
    expect(app.supportedLocales, contains(const Locale('ar')));
    expect(app.supportedLocales, contains(const Locale('en')));
  });
}
