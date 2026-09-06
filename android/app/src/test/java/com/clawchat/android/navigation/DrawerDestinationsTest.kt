package com.clawchat.android.navigation

import com.clawchat.android.core.data.WorkspaceMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DrawerDestinationsTest {
    @Test fun `every supported drawer route has one label and a distinct standard size icon`() {
        val destinations = allDrawerDestinations.associateBy { it.route }
        assertEquals(allDrawerDestinations.size, destinations.size)
        val routes = WorkspaceMode.entries.flatMap(NavigationCapabilities::drawerRoutes).toSet()
        assertEquals(routes, destinations.keys)
        assertEquals(destinations.size, destinations.values.map { it.icon.name }.toSet().size)
        destinations.values.forEach {
            assertTrue(it.labelRes != 0)
            assertEquals(24f, it.icon.defaultWidth.value)
            assertEquals(24f, it.icon.defaultHeight.value)
        }
    }
}
