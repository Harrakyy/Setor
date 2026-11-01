package com.harrakyy.setorpantau;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SetorNotifierTest {
    @Test
    public void parseAmount_samaDenganCoreJs() {
        assertEquals(1000, SetorNotifier.parseAmount("Rp1.000 diterima DANA Bisnis."));
        assertEquals(799873, SetorNotifier.parseAmount("Rp 799.873 diterima DANA Bisnis."));
        assertEquals(15000, SetorNotifier.parseAmount("Rp15.000,00 diterima"));
        assertEquals(-1, SetorNotifier.parseAmount("Cashback Rp10.000 untukmu"));
        assertEquals(-1, SetorNotifier.parseAmount(null));
    }

    @Test
    public void notifId_formatSamaDenganCoreJs() {
        assertEquals("id.dana|1700|Rp1.000 diterima", SetorNotifier.notifId("id.dana", 1700, "Rp1.000 diterima"));
    }

    @Test
    public void inBand_tigaDigitTerakhir() {
        assertTrue(SetorNotifier.inBand(799873, 500, 999));
        assertFalse(SetorNotifier.inBand(120350, 500, 999));
        assertFalse(SetorNotifier.inBand(50000, 500, 999));
        assertTrue(SetorNotifier.inBand(35017, 1, 99));
    }

    @Test
    public void rupiah_titikRibuan() {
        assertEquals("Rp799.873", SetorNotifier.rupiah(799873));
    }
}
