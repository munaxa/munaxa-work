// Munaxa Work mobile — bootstrap only.
//
// Phase 0 proves the application builds and reaches the API. Every screen, every request type
// and the offline attendance capture are delivered by Phase 19.1
// (20A_PHASE_19.1_MOBILE_APPLICATIONS.md).
//
// This client owns no business logic. It consumes /api/v1 exactly as the web portals do, and it
// carries no advertising or third-party marketing (ADR-0028).

import 'package:flutter/material.dart';

void main() {
  runApp(const MunaxaWorkApp());
}

class MunaxaWorkApp extends StatelessWidget {
  const MunaxaWorkApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Munaxa Work',
      // Both directions are supported from the first screen, not retrofitted: the layout is
      // never allowed to assume text direction (00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md).
      locale: const Locale('en'),
      supportedLocales: const [Locale('en'), Locale('ar')],
      theme: ThemeData(useMaterial3: true),
      home: const BootstrapScreen(),
    );
  }
}

class BootstrapScreen extends StatelessWidget {
  const BootstrapScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Munaxa Work')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Bootstrapped. Screens arrive in Phase 19.1.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
